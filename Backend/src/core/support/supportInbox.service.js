import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError.js';
import { decideAdminAccess } from '../admin/adminAccessPolicy.js';

/**
 * One support inbox for the whole platform (Master > Help & Support).
 *
 * Tickets are raised in seven places -- customers, restaurants/stores and riders
 * in Food and in Quick (which includes Medical), and everyone in Taxi -- and each
 * service's admin saw only its own. This reads all seven into one list and hands
 * every change back to the service that owns the ticket: a reply goes through
 * that service's own update function, so whatever it already does on a reply
 * (Quick notifies the customer, Taxi adds to the conversation) still happens,
 * and each service's own screen keeps showing the same ticket.
 *
 * The tickets stay where they are. Moving them into one collection would mean
 * changing every app that raises or reads one; this gives admins one place to
 * work without touching any of them.
 *
 * Statuses differ per service and are shown as three:
 *   open         food/quick 'open', taxi 'pending'
 *   in_progress  food/quick 'in-progress' / 'in_progress', taxi 'assigned'
 *   resolved     food/quick 'resolved' (and riders' 'closed'), taxi 'closed'
 */

export const INBOX_STATUSES = ['open', 'in_progress', 'resolved'];

const PER_SOURCE_LIMIT = 500;

const model = async (path, name) => (await import(path))[name];
const foodAdmin = () => import('../../modules/food/admin/services/admin.service.js');
const quickAdmin = () => import('../../modules/quickCommerce/modules/food/admin/services/admin.service.js');

/*
 * Each source: where its tickets are, whose they are, and how to write back.
 * `service` is the admin API the ticket belongs to, for permissions.
 */
const SOURCES = {
  food_customer: {
    label: 'Food · Customer',
    service: 'food',
    requesterType: 'customer',
    load: () => model('../../modules/food/user/models/supportTicket.model.js', 'FoodSupportTicket'),
    people: { field: 'userId', collection: 'users', name: (d) => d.name, phone: (d) => d.phone },
    toInbox: (s) => ({ 'in-progress': 'in_progress' }[s] || s),
    toOwn: (s) => ({ in_progress: 'in-progress' }[s] || s),
    update: async (id, { status, reply }) => (await foodAdmin()).updateSupportTicket(id, { source: 'user', status, adminResponse: reply }),
  },
  food_restaurant: {
    label: 'Food · Restaurant',
    service: 'food',
    requesterType: 'restaurant',
    load: () => model('../../modules/food/restaurant/models/supportTicket.model.js', 'FoodRestaurantSupportTicket'),
    people: { field: 'restaurantId', collection: 'food_restaurants', name: (d) => d.restaurantName, phone: (d) => d.ownerPhone || d.phone },
    toInbox: (s) => ({ 'in-progress': 'in_progress' }[s] || s),
    toOwn: (s) => ({ in_progress: 'in-progress' }[s] || s),
    update: async (id, { status, reply }) => (await foodAdmin()).updateSupportTicket(id, { source: 'restaurant', status, adminResponse: reply }),
  },
  food_rider: {
    label: 'Food · Rider',
    service: 'food',
    requesterType: 'rider',
    load: () => model('../../modules/food/delivery/models/supportTicket.model.js', 'DeliverySupportTicket'),
    people: { field: 'deliveryPartnerId', collection: 'food_delivery_partners', name: (d) => d.name, phone: (d) => d.phone },
    toInbox: (s) => (s === 'closed' ? 'resolved' : s),
    toOwn: (s) => s,
    update: async (id, { status, reply }) => (await foodAdmin()).updateDeliverySupportTicket(id, { status, adminResponse: reply }),
  },
  quick_customer: {
    label: 'Quick · Customer',
    service: 'quickCommerce',
    requesterType: 'customer',
    load: () => model('../../modules/quickCommerce/modules/food/user/models/supportTicket.model.js', 'FoodSupportTicket'),
    people: { field: 'userId', collection: 'qc_users', name: (d) => d.name, phone: (d) => d.phone },
    toInbox: (s) => ({ 'in-progress': 'in_progress' }[s] || s),
    toOwn: (s) => ({ in_progress: 'in-progress' }[s] || s),
    update: async (id, { status, reply }) => (await quickAdmin()).updateSupportTicket(id, { source: 'user', status, adminResponse: reply }),
  },
  quick_store: {
    label: 'Quick · Store',
    service: 'quickCommerce',
    requesterType: 'store',
    load: () => model('../../modules/quickCommerce/modules/food/restaurant/models/supportTicket.model.js', 'FoodRestaurantSupportTicket'),
    people: { field: 'restaurantId', collection: 'qc_restaurants', name: (d) => d.restaurantName, phone: (d) => d.ownerPhone || d.phone },
    toInbox: (s) => ({ 'in-progress': 'in_progress' }[s] || s),
    toOwn: (s) => ({ in_progress: 'in-progress' }[s] || s),
    update: async (id, { status, reply }) => (await quickAdmin()).updateSupportTicket(id, { source: 'restaurant', status, adminResponse: reply }),
  },
  quick_rider: {
    label: 'Quick · Rider',
    service: 'quickCommerce',
    requesterType: 'rider',
    load: () => model('../../modules/quickCommerce/modules/food/delivery/models/supportTicket.model.js', 'DeliverySupportTicket'),
    people: { field: 'deliveryPartnerId', collection: 'qc_delivery_partners', name: (d) => d.name, phone: (d) => d.phone },
    toInbox: (s) => (s === 'closed' ? 'resolved' : s),
    toOwn: (s) => s,
    update: async (id, { status, reply }) => (await quickAdmin()).updateDeliverySupportTicket(id, { status, adminResponse: reply }),
  },
  taxi: {
    label: 'Taxi',
    service: 'taxi',
    requesterType: null, // per ticket: user, driver or owner
    load: () => model('../../modules/taxi/support/models/SupportTicket.js', 'SupportTicket'),
    people: null, // name and phone are stored on the ticket
    toInbox: (s) => ({ pending: 'open', assigned: 'in_progress', closed: 'resolved' }[s] || s),
    toOwn: (s) => ({ open: 'pending', in_progress: 'assigned', resolved: 'closed' }[s] || s),
    update: taxiUpdate,
  },
};

export const INBOX_SOURCES = Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, service: s.service }));

/* ------------------------------------------------------------ permissions */

const canSee = (admin, source, write = false) =>
  decideAdminAccess(admin, { service: SOURCES[source].service, resource: 'support', write }).allowed;

const visibleSources = (admin) => Object.keys(SOURCES).filter((key) => canSee(admin, key));

/* -------------------------------------------------------------- reading */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

/** Names and phones for one source's tickets, in one query. */
async function peopleFor(source, docs) {
  const people = SOURCES[source].people;
  if (!people) return new Map();
  const ids = [...new Set(docs.map((d) => String(d[people.field] || '')).filter(isId))];
  if (!ids.length) return new Map();
  const rows = await mongoose.connection
    .collection(people.collection)
    .find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ name: 1, phone: 1, restaurantName: 1, ownerPhone: 1 })
    .toArray();
  return new Map(rows.map((r) => [String(r._id), { name: people.name(r) || '', phone: people.phone(r) || '' }]));
}

function toRow(source, doc, person) {
  const def = SOURCES[source];
  const rawStatus = String(doc.status || '');
  const taxi = source === 'taxi';
  const messages = taxi ? (doc.messages || []) : [];
  const lastAdmin = [...messages].reverse().find((m) => m.senderRole === 'admin');
  return {
    key: `${source}:${doc._id}`,
    id: String(doc._id),
    source,
    sourceLabel: def.label,
    service: def.service,
    code: doc.ticketId || doc.ticketCode || String(doc._id).slice(-6).toUpperCase(),
    requesterType: def.requesterType || doc.requesterRole || doc.userType || 'user',
    requesterName: (taxi ? doc.requesterName : person?.name) || '',
    requesterPhone: (taxi ? doc.requesterPhone : person?.phone) || '',
    subject: doc.subject || doc.title || doc.issueType || 'Support request',
    description: doc.description || (messages[0]?.message ?? ''),
    category: doc.category || doc.type || doc.supportType || '',
    priority: doc.priority || '',
    orderRef: doc.orderRef || (doc.orderId ? String(doc.orderId) : ''),
    status: def.toInbox(rawStatus),
    rawStatus,
    reply: taxi ? (lastAdmin?.message || '') : (doc.adminResponse || ''),
    messages: messages.map((m) => ({
      from: m.senderRole === 'admin' ? 'admin' : 'requester',
      name: m.senderName || '',
      message: m.message,
      at: m.createdAt || null,
    })),
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || doc.lastMessageAt || doc.createdAt || null,
  };
}

function ownFilter(source, { status, q }) {
  const def = SOURCES[source];
  const filter = {};
  if (status && INBOX_STATUSES.includes(status)) {
    const own = def.toOwn(status);
    // Riders' 'closed' reads as resolved, so asking for resolved finds both.
    filter.status = status === 'resolved' && source.endsWith('_rider') ? { $in: ['resolved', 'closed'] } : own;
  }
  const term = String(q || '').trim();
  if (term) {
    const rx = { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [
      { subject: rx }, { description: rx }, { issueType: rx }, { title: rx },
      { ticketId: rx }, { ticketCode: rx }, { requesterName: rx }, { requesterPhone: rx }, { orderRef: rx },
    ];
  }
  return filter;
}

/**
 * The inbox: every ticket this admin may see, newest activity first.
 *
 * ponytail: each source is read (up to PER_SOURCE_LIMIT, newest first) and the
 * page is cut after merging. Fine while support volume is small -- every one
 * of these collections was empty when this was written; a real paging cursor
 * across sources is the fix if an inbox ever holds thousands.
 */
export async function listInbox(admin, query = {}) {
  const allowed = visibleSources(admin);
  const wanted = String(query.source || '').trim();
  const service = String(query.service || '').trim();
  const sources = allowed.filter((s) => (!wanted || s === wanted) && (!service || SOURCES[s].service === service));
  const status = String(query.status || '').trim();
  const q = String(query.q || '').trim();

  const perSource = await Promise.all(
    sources.map(async (source) => {
      const Model = await SOURCES[source].load();
      const docs = await Model.find(ownFilter(source, { status, q }))
        .sort({ updatedAt: -1 })
        .limit(PER_SOURCE_LIMIT)
        .lean();
      const people = await peopleFor(source, docs);
      const field = SOURCES[source].people?.field;
      return docs.map((d) => toRow(source, d, field ? people.get(String(d[field] || '')) : null));
    }),
  );

  const rows = perSource.flat().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    total: rows.length,
    page,
    limit,
    sources: INBOX_SOURCES.filter((s) => allowed.includes(s.key)),
  };
}

/** Open / in progress / resolved per source, for the header. */
export async function inboxStats(admin) {
  const sources = visibleSources(admin);
  const counts = { open: 0, in_progress: 0, resolved: 0 };
  const bySource = {};
  await Promise.all(
    sources.map(async (source) => {
      const Model = await SOURCES[source].load();
      const grouped = await Model.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
      const mine = { open: 0, in_progress: 0, resolved: 0 };
      for (const g of grouped) {
        const s = SOURCES[source].toInbox(String(g._id || ''));
        if (mine[s] !== undefined) mine[s] += g.n;
      }
      bySource[source] = mine;
      for (const k of Object.keys(counts)) counts[k] += mine[k];
    }),
  );
  return { counts, bySource };
}

export async function getInboxTicket(admin, source, id) {
  const def = SOURCES[source];
  if (!def) throw new ApiError(404, 'Unknown ticket source');
  if (!canSee(admin, source)) throw new ApiError(403, 'You do not have access to these tickets');
  if (!isId(id)) throw new ApiError(404, 'Ticket not found');
  const Model = await def.load();
  const doc = await Model.findById(id).lean();
  if (!doc) throw new ApiError(404, 'Ticket not found');
  const people = await peopleFor(source, [doc]);
  return toRow(source, doc, def.people ? people.get(String(doc[def.people.field] || '')) : null);
}

/* -------------------------------------------------------------- writing */

/**
 * Reply to a ticket, change its status, or both -- through the owning
 * service's own update code.
 */
export async function updateInboxTicket(admin, source, id, body = {}) {
  const def = SOURCES[source];
  if (!def) throw new ApiError(404, 'Unknown ticket source');
  if (!canSee(admin, source, true)) throw new ApiError(403, 'You can view these tickets but not answer them');
  if (!isId(id)) throw new ApiError(404, 'Ticket not found');

  const status = body.status === undefined || body.status === '' ? undefined : String(body.status);
  if (status !== undefined && !INBOX_STATUSES.includes(status)) throw new ApiError(400, 'Pick open, in progress or resolved');
  const reply = typeof body.reply === 'string' ? body.reply.trim() : undefined;
  if (reply !== undefined && reply.length > 4000) throw new ApiError(400, 'Keep the reply under 4000 characters');
  if (status === undefined && !reply) throw new ApiError(400, 'Write a reply or pick a status');

  const Model = await def.load();
  const exists = await Model.exists({ _id: id });
  if (!exists) throw new ApiError(404, 'Ticket not found');

  await def.update(id, { status: status === undefined ? undefined : def.toOwn(status), reply: reply || undefined }, admin);
  return getInboxTicket(admin, source, id);
}

/*
 * Taxi's admin actions are Express handlers (modules/taxi/support). They are
 * called here with the request they expect rather than copied, so a reply from
 * the inbox is recorded exactly like one from the Taxi panel: in the ticket's
 * conversation, assigned to the admin who wrote it.
 */
async function taxiUpdate(id, { status, reply }, admin) {
  const { SupportTicket } = await import('../../modules/taxi/support/models/SupportTicket.js');
  const controllers = await import('../../modules/taxi/support/controllers/supportController.js');
  const ticket = await SupportTicket.findById(id).select('ticketCode').lean();
  if (!ticket) throw new ApiError(404, 'Ticket not found');
  const call = (handler, bodyIn) =>
    handler(
      { params: { ticketCode: ticket.ticketCode }, body: bodyIn, auth: { sub: String(admin._id) }, user: { id: String(admin._id) } },
      { json: () => undefined, status() { return this; } },
    );
  if (reply) await call(controllers.adminReplySupportTicket, { message: reply });
  if (status) await call(controllers.adminUpdateSupportTicket, { status });
}
