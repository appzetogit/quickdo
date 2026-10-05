export const formatCurrency = (value) => {
  const n = Number(value || 0);
  return `₹${n.toLocaleString('en-IN')}`;
};

export const formatDate = (dateStr, options = {}) => {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', options);
};

export const getDateRange = (period) => {
  const end = new Date();
  const start = new Date();
  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  if (period === 'week') start.setDate(end.getDate() - 7);
  else if (period === 'month') start.setDate(end.getDate() - 30);
  else if (period === 'year') start.setDate(end.getDate() - 365);
  else start.setDate(end.getDate() - 30);
  return { start, end };
};

export const filterByDateRange = (data, start, end) => {
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  return (data || []).filter((item) => {
    const d = new Date(item.date);
    return !Number.isNaN(d.getTime()) && d >= s && d <= e;
  });
};



