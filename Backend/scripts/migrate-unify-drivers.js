/**
 * Driver unification backfill (SOW plan §8, step 1).
 *
 * Folds every FoodDeliveryPartner into the unified taxi Driver identity, keyed by phone:
 *   - existing driver (same phone, same person) -> grant the delivery capabilities, copy the
 *     delivery dispatch hints, link legacyDeliveryPartnerId, create its DeliveryProfile
 *   - no matching driver                        -> create a delivery-only Driver, then its profile
 * It also links the rider's Quick Commerce record (qc_delivery_partners) to the same driver,
 * snapshots the delivery wallet into the profile for later reconciliation, and sets the reverse
 * link FoodDeliveryPartner.driverId.
 *
 * SAFE BY DEFAULT
 *   - Dry run unless --apply is given. A dry run reads everything and writes nothing.
 *   - Idempotent: a partner already linked to its driver is reported as such and left alone
 *     (no new driver, no new profile, the first wallet snapshot is kept).
 *   - Never mutates live wallet balances and never touches taxi dispatch fields.
 *   - Anything ambiguous is reported as a CONFLICT and skipped, never guessed:
 *       ambiguous_driver_match          the phone matches more than one driver
 *       duplicate_partner_phone         two delivery partners share the phone
 *       name_mismatch                   same phone, but the names say different people
 *       driver_linked_to_other_partner  the driver is already linked to another partner
 *       partner_linked_to_other_driver  the partner is already linked to another driver
 *       driver_deleted                  the matching driver is soft-deleted
 *       qc_rider_linked_to_other_driver the Quick rider record points at another driver
 *                                       (food link still made; QC link skipped)
 *       driver_linked_to_other_qc_rider the driver already names a different Quick rider
 *                                       (food link still made; QC link skipped)
 *
 * CAPABILITIES. A linked or created driver is granted 'delivery' AND 'quickCommerce': every
 * food rider is offered grocery orders today (core/delivery/qcRiderLink), and Quick dispatch
 * with UNIFIED_DISPATCH_ENABLED on keeps only drivers holding 'quickCommerce'. Granting only
 * 'delivery' would take grocery work away from every migrated rider the day the flag flips.
 *
 * Usage:
 *   node scripts/migrate-unify-drivers.js                         # dry run (default)
 *   node scripts/migrate-unify-drivers.js --dry-run               # same, explicit
 *   node scripts/migrate-unify-drivers.js --apply                 # write
 *   node scripts/migrate-unify-drivers.js --apply --allow-name-mismatch
 *        # link same-phone records even when the names disagree (after checking the report)
 *   node scripts/migrate-unify-drivers.js --apply --no-qc
 *        # do not grant 'quickCommerce' or link Quick rider records
 *   --json   print the final report as JSON only (for scripting)
 *
 * Exit code: 0 when the run finished (conflicts are reported, not failures), 1 on error.
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { pathToFileURL } from 'node:url';

export const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const nameTokens = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

/**
 * Whether two display names can belong to the same person. Deliberately lenient: an empty
 * name, the same first name, or one name contained in the other all pass ("Ravi" / "Ravi D").
 * What it catches is a recycled phone number now owned by somebody else ("Ravi Kumar" /
 * "Suresh Patel").
 */
export const namesCompatible = (a, b) => {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return true;
  if (ta[0] === tb[0]) return true;
  const ja = ta.join(' ');
  const jb = tb.join(' ');
  if (ja.includes(jb) || jb.includes(ja)) return true;
  // Generic placeholders from older sign-up flows say nothing about who it is.
  const generic = new Set(['driver', 'rider', 'delivery', 'partner', 'user']);
  if (ta.every((t) => generic.has(t)) || tb.every((t) => generic.has(t))) return true;
  return false;
};

const DELIVERY_CAPS = ['delivery', 'quickCommerce'];

/**
 * Run the backfill against the CURRENT mongoose connection.
 *
 * @param {{apply?: boolean, allowNameMismatch?: boolean, includeQc?: boolean, log?: (line: string) => void}} opts
 * @returns {Promise<{mode: string, stats: object, conflicts: object[], actions: object[]}>}
 */
export async function migrateUnifyDrivers({
  apply = false,
  allowNameMismatch = false,
  includeQc = true,
  log = () => {},
} = {}) {
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
  const { FoodDeliveryWallet } = await import('../src/modules/food/delivery/models/deliveryWallet.model.js');
  const { DeliveryProfile } = await import('../src/modules/food/delivery/models/deliveryProfile.model.js');
  const { FoodDeliveryPartner: QcRider } = await import(
    '../src/modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js'
  );

  const partners = await FoodDeliveryPartner.find({}).lean();
  const stats = {
    partners: partners.length,
    alreadyLinked: 0,
    linked: 0,
    created: 0,
    capabilityAdded: 0,
    profilesCreated: 0,
    qcLinked: 0,
    conflicts: 0,
    skipped: 0,
    errors: 0,
  };
  const conflicts = [];
  const actions = [];
  const conflict = (partner, code, detail = {}) => {
    stats.conflicts += 1;
    const row = { partnerId: String(partner._id), phone: normalizePhone(partner.phone), name: partner.name || '', code, ...detail };
    conflicts.push(row);
    log(`  CONFLICT ${code}: partner ${row.partnerId} (${row.phone}) ${JSON.stringify(detail)}`);
  };

  log(`${apply ? 'APPLY' : 'DRY RUN'}: ${partners.length} delivery partners to process`);

  // Two partners on one phone cannot both be "the" delivery identity of one driver.
  const byPhone = new Map();
  for (const p of partners) {
    const phone = normalizePhone(p.phone);
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(p);
  }

  for (const p of partners) {
    const phone10 = normalizePhone(p.phone);
    if (!phone10) {
      stats.skipped += 1;
      log(`  skip (no phone): ${p._id}`);
      continue;
    }

    try {
      const samePhone = byPhone.get(phone10) || [];
      if (samePhone.length > 1) {
        conflict(p, 'duplicate_partner_phone', { partnerIds: samePhone.map((x) => String(x._id)) });
        continue;
      }

      // Every driver on this phone, deleted ones included, so the report can say why.
      const matches = await Driver.find({ phone: { $regex: `${phone10}$` } })
        .select('_id name phone deletedAt serviceCapabilities legacyDeliveryPartnerId legacyQcPartnerId delivery')
        .lean();
      const live = matches.filter((d) => !d.deletedAt);

      // Already linked to a driver by an earlier run (or by onboarding).
      if (p.driverId) {
        const linked = await Driver.findById(p.driverId)
          .select('_id name phone deletedAt serviceCapabilities legacyDeliveryPartnerId legacyQcPartnerId delivery')
          .lean();
        if (linked && live.length && !live.some((d) => String(d._id) === String(linked._id))) {
          conflict(p, 'partner_linked_to_other_driver', {
            linkedDriverId: String(linked._id),
            phoneDriverIds: live.map((d) => String(d._id)),
          });
          continue;
        }
        // The driver changed their phone since the link was made: keep the link rather than
        // creating a second driver for the same person.
        if (linked && !linked.deletedAt && !live.length) live.push(linked);
      }

      if (live.length > 1) {
        conflict(p, 'ambiguous_driver_match', { driverIds: live.map((d) => String(d._id)) });
        continue;
      }
      if (!live.length && matches.length) {
        conflict(p, 'driver_deleted', { driverIds: matches.map((d) => String(d._id)) });
        continue;
      }

      let driver = live[0] || null;

      if (driver) {
        if (driver.legacyDeliveryPartnerId && String(driver.legacyDeliveryPartnerId) !== String(p._id)) {
          conflict(p, 'driver_linked_to_other_partner', {
            driverId: String(driver._id),
            linkedPartnerId: String(driver.legacyDeliveryPartnerId),
          });
          continue;
        }
        const alreadyLinked = String(driver.legacyDeliveryPartnerId || '') === String(p._id)
          && String(p.driverId || '') === String(driver._id);
        if (!alreadyLinked && !allowNameMismatch && !namesCompatible(driver.name, p.name)) {
          conflict(p, 'name_mismatch', { driverId: String(driver._id), driverName: driver.name || '', partnerName: p.name || '' });
          continue;
        }
      }

      const wantedCaps = includeQc ? DELIVERY_CAPS : ['delivery'];

      if (!driver) {
        stats.created += 1;
        actions.push({ action: 'create_driver', partnerId: String(p._id), phone: phone10 });
        log(`  create driver <- partner ${p._id} (${phone10})`);
        if (apply) {
          const created = await Driver.create({
            name: p.name || 'Delivery Partner',
            phone: p.phone,
            // Placeholder password (select:false). Delivery sign-in is OTP based and unchanged.
            password: crypto.randomBytes(16).toString('hex'),
            vehicleType: p.vehicleType || 'bike',
            serviceCapabilities: wantedCaps,
            workMode: 'all',
            status: p.status === 'approved' ? 'approved' : 'pending',
            approve: p.status === 'approved',
            city: p.city || '',
            profileImage: p.profilePhoto || '',
            legacyDeliveryPartnerId: p._id,
            location: p.lastLocation?.coordinates?.length === 2
              ? { type: 'Point', coordinates: p.lastLocation.coordinates }
              : { type: 'Point', coordinates: [0, 0] },
            delivery: {
              vehicleType: p.vehicleType || '',
              vehicleName: p.vehicleName || '',
              vehicleNumber: p.vehicleNumber || '',
              codCashLimit: 0,
            },
          });
          driver = created.toObject();
        }
      } else {
        const caps = new Set(driver.serviceCapabilities || []);
        const missing = wantedCaps.filter((c) => !caps.has(c));
        const linkMissing = String(driver.legacyDeliveryPartnerId || '') !== String(p._id)
          || String(p.driverId || '') !== String(driver._id);

        if (!missing.length && !linkMissing) {
          stats.alreadyLinked += 1;
          log(`  already linked: driver ${driver._id} <- partner ${p._id}`);
        } else {
          if (missing.length) stats.capabilityAdded += 1;
          stats.linked += 1;
          actions.push({ action: 'link_driver', partnerId: String(p._id), driverId: String(driver._id), addCapabilities: missing });
          log(`  link driver ${driver._id} <- partner ${p._id} (${phone10})${missing.length ? ` +${missing.join(',')}` : ''}`);
          if (apply) {
            await Driver.updateOne(
              { _id: driver._id },
              {
                $addToSet: { serviceCapabilities: { $each: wantedCaps } },
                $set: {
                  legacyDeliveryPartnerId: p._id,
                  'delivery.vehicleType': p.vehicleType || driver.delivery?.vehicleType || '',
                  'delivery.vehicleName': p.vehicleName || driver.delivery?.vehicleName || '',
                  'delivery.vehicleNumber': p.vehicleNumber || driver.delivery?.vehicleNumber || '',
                },
              },
            );
          }
        }
      }

      // From here the driver exists (or would, on a dry run).
      const driverId = driver?._id || null;

      if (apply && driverId) {
        if (String(p.driverId || '') !== String(driverId)) {
          await FoodDeliveryPartner.updateOne({ _id: p._id }, { $set: { driverId } });
        }

        // DeliveryProfile: one per driver. KYC fields are refreshed; the wallet snapshot is
        // taken once and never overwritten, so a re-run cannot move the reconciliation base.
        const existing = await DeliveryProfile.findOne({ driverId }).select('_id walletSnapshot').lean();
        const kyc = {
          legacyDeliveryPartnerId: p._id,
          address: p.address || '', city: p.city || '', state: p.state || '',
          panNumber: p.panNumber || '', aadharNumber: p.aadharNumber || '',
          drivingLicenseNumber: p.drivingLicenseNumber || '',
          aadharPhoto: p.aadharPhoto || '', panPhoto: p.panPhoto || '',
          drivingLicensePhoto: p.drivingLicensePhoto || '',
          bankAccountHolderName: p.bankAccountHolderName || '', bankAccountNumber: p.bankAccountNumber || '',
          bankIfscCode: p.bankIfscCode || '', bankName: p.bankName || '',
          upiId: p.upiId || '', upiQrCode: p.upiQrCode || '',
          referralCode: p.referralCode || '', referredByLegacyId: p.referredBy || null,
        };
        const set = { ...kyc };
        if (!existing?.walletSnapshot?.capturedAt) {
          const wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId: p._id }).lean();
          set.walletSnapshot = {
            balance: wallet?.balance || 0,
            cashInHand: wallet?.cashInHand || 0,
            lockedAmount: wallet?.lockedAmount || 0,
            totalEarnings: wallet?.totalEarnings || 0,
            totalSettled: wallet?.totalSettled || 0,
            totalDeliveries: wallet?.totalDeliveries || 0,
            capturedAt: new Date(),
            reconciled: false,
          };
        }
        await DeliveryProfile.updateOne({ driverId }, { $set: set }, { upsert: true });
        if (!existing) stats.profilesCreated += 1;
      } else if (!apply) {
        const existing = driverId ? await DeliveryProfile.exists({ driverId }) : null;
        if (!existing) stats.profilesCreated += 1;
      }

      // Quick Commerce rider record: the delivery app delivers QC orders as this record.
      if (includeQc) {
        const qcCandidates = await QcRider.find({
          $or: [
            ...(driverId ? [{ driverId }] : []),
            { phone: { $regex: `${phone10}$` } },
          ],
        }).select('_id driverId phone').lean();
        const qc = qcCandidates.find((r) => driverId && String(r.driverId || '') === String(driverId))
          || qcCandidates[0]
          || null;
        if (qc) {
          const hubQc = driver?.legacyQcPartnerId ? String(driver.legacyQcPartnerId) : null;
          if (qc.driverId && driverId && String(qc.driverId) !== String(driverId)) {
            conflict(p, 'qc_rider_linked_to_other_driver', { qcRiderId: String(qc._id), linkedDriverId: String(qc.driverId) });
          } else if (hubQc && hubQc !== String(qc._id)) {
            // The driver already names a different Quick record; leave both alone.
            conflict(p, 'driver_linked_to_other_qc_rider', { qcRiderId: String(qc._id), linkedQcRiderId: hubQc });
          } else {
            const qcDone = Boolean(driverId) && String(qc.driverId || '') === String(driverId) && hubQc === String(qc._id);
            if (!qcDone) {
              stats.qcLinked += 1;
              actions.push({ action: 'link_qc_rider', partnerId: String(p._id), qcRiderId: String(qc._id), driverId: driverId ? String(driverId) : null });
              if (apply && driverId) {
                await QcRider.updateOne(
                  { _id: qc._id, $or: [{ driverId: null }, { driverId: { $exists: false } }, { driverId }] },
                  { $set: { driverId } },
                );
                await Driver.updateOne(
                  { _id: driverId, $or: [{ legacyQcPartnerId: null }, { legacyQcPartnerId: { $exists: false } }] },
                  { $set: { legacyQcPartnerId: qc._id } },
                );
              }
            }
          }
        }
      }
    } catch (err) {
      stats.errors += 1;
      log(`  ERROR partner ${p._id} (${phone10}): ${err.message}`);
    }
  }

  log(`\nDone (${apply ? 'applied' : 'dry run, no writes'}):`);
  log(JSON.stringify(stats, null, 2));
  if (conflicts.length) log(`\n${conflicts.length} conflict(s) need a person to look at them; they were skipped.`);
  if (!apply) log('\nRe-run with --apply to write changes.');

  return { mode: apply ? 'apply' : 'dry-run', stats, conflicts, actions };
}

const isCli = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isCli) {
  dotenv.config();
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  const json = argv.includes('--json');
  const opts = {
    apply,
    allowNameMismatch: argv.includes('--allow-name-mismatch'),
    includeQc: !argv.includes('--no-qc'),
    log: json ? () => {} : (line) => console.log(line),
  };

  let code = 0;
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('Missing MONGODB_URI / MONGO_URI in environment.');
    const dbName = process.env.MONGODB_DB_NAME || undefined;
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    const report = await migrateUnifyDrivers(opts);
    if (json) console.log(JSON.stringify(report));
    if (report.stats.errors) code = 1;
  } catch (err) {
    console.error('Migration failed:', err);
    code = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(code);
}
