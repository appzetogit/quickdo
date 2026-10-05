import mongoose from 'mongoose';
import { zoneSchema } from './zone.model.js';

/**
 * Medical's own delivery zones.
 *
 * A pharmacy is a quick-commerce seller and shared quick commerce's zones until
 * now, which meant a zone drawn for groceries also decided where medicine could
 * go, and a zone drawn in the Medical panel appeared under Quick Shop. The two
 * are not the same question: medicine travels under a drug licence, its riders
 * and its hours differ, and the platform's owner wants the map for it drawn
 * separately.
 *
 * Same SHAPE as a quick-commerce zone -- deliberately the same schema object,
 * so a field added to one is added to both and the two cannot drift into
 * different ideas of what a zone is -- but its own collection, so the contents
 * are independent from the moment this exists.
 *
 * Ids are shared with the quick-commerce zones they were copied from
 * (scripts/split-medical-zones.js). That is what let nine pharmacies keep
 * working through the split without a single seller document being rewritten:
 * `zoneId` resolves the same either side, and only the collection it resolves
 * against changed. Zones created here afterwards have ids of their own and
 * exist nowhere else.
 */
export const MedicalZone = mongoose.models.MedicalZone
    || mongoose.model('MedicalZone', zoneSchema, 'medical_zones');
