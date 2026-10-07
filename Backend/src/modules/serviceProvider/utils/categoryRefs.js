/**
 * Category references on providers (plan §3.3).
 *
 * Providers used to store free-text category names. They now also store Category
 * ObjectIds (categoryIds). Writes accept either form, ids or names (title or
 * slug, case-insensitive), and return both so the legacy name arrays that
 * assignment and dashboards still query stay in step. Unknown names are kept as
 * names (nothing is dropped); unknown ids are rejected.
 */
const mongoose = require('mongoose');

const isObjectId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveCategoryRefs = async (values) => {
  const Category = require('../models/Category');
  const list = (Array.isArray(values) ? values : [values])
    .map((v) => (v && typeof v === 'object' ? String(v._id || v.id || v.title || '') : String(v ?? '')).trim())
    .filter(Boolean);
  const idInputs = [...new Set(list.filter(isObjectId))];
  const nameInputs = [...new Set(list.filter((v) => !isObjectId(v)))];

  const byId = idInputs.length
    ? await Category.find({ _id: { $in: idInputs } }).select('title slug').lean()
    : [];
  const unknownIds = idInputs.filter((id) => !byId.some((c) => String(c._id) === id.toLowerCase()));

  const byName = nameInputs.length
    ? await Category.find({
        $or: nameInputs.flatMap((n) => [
          { title: { $regex: new RegExp(`^${escapeRegex(n)}$`, 'i') } },
          { slug: n.toLowerCase() }
        ])
      }).select('title slug').lean()
    : [];

  const ids = [];
  const names = [];
  const add = (id, name) => {
    if (id && !ids.some((x) => String(x) === String(id))) ids.push(new mongoose.Types.ObjectId(String(id)));
    if (name && !names.includes(name)) names.push(name);
  };
  // Keep the caller's order.
  list.forEach((v) => {
    if (isObjectId(v)) {
      const c = byId.find((x) => String(x._id) === v.toLowerCase());
      if (c) add(c._id, c.title);
      return;
    }
    const c = byName.find((x) => x.title.toLowerCase() === v.toLowerCase() || x.slug === v.toLowerCase());
    if (c) add(c._id, c.title);
    else add(null, v);
  });
  return { ids, names, unknownIds };
};

module.exports = { resolveCategoryRefs, isObjectId };
