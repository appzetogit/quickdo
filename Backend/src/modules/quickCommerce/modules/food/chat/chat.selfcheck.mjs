// Standalone check of the pure chat helpers — no DB, no server.
//   node src/modules/food/chat/chat.selfcheck.mjs
import assert from 'node:assert';

const partyToken = (role, id) => (role === 'ADMIN' ? 'ADMIN' : `${role}:${String(id)}`);
const buildConversationId = (a, b, orderId) => {
    const scope = orderId ? String(orderId) : 'direct';
    return `${scope}::${[a, b].sort().join('|')}`;
};

// ADMIN token is id-independent (shared inbox).
assert.equal(partyToken('ADMIN', 'anything'), 'ADMIN');
assert.equal(partyToken('USER', 'abc'), 'USER:abc');

// Conversation id is order-independent of argument order (user→driver == driver→user).
const u = partyToken('USER', 'u1');
const d = partyToken('DELIVERY_PARTNER', 'd1');
assert.equal(buildConversationId(u, d, 'o1'), buildConversationId(d, u, 'o1'));

// Different order = different thread.
assert.notEqual(buildConversationId(u, d, 'o1'), buildConversationId(u, d, 'o2'));

// Admin direct chats (no order) collapse regardless of which admin replies.
const a = partyToken('ADMIN', 'admin-7');
const a2 = partyToken('ADMIN', 'admin-9');
assert.equal(buildConversationId(u, a, null), buildConversationId(u, a2, null));

// Two different users messaging admin get separate threads.
const u2 = partyToken('USER', 'u2');
assert.notEqual(buildConversationId(u, a, null), buildConversationId(u2, a, null));

console.log('chat helpers: all assertions passed');
