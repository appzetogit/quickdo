import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

/**
 * Transactions on a standalone MongoDB.
 *
 * MongoDB only runs multi-document transactions on a replica set or sharded
 * cluster. On a standalone server every `session.startTransaction()` makes the
 * next operation fail with "Transaction numbers are only allowed on a replica
 * set member or mongos" -- a 500 on every taxi cancel, accept or wallet move
 * (the superapp server runs a standalone mongod shared with other apps).
 *
 * When the connected server is standalone, the transaction calls on
 * ClientSession become no-ops and withTransaction just runs its callback: each
 * write still happens, in order, but without all-or-nothing rollback -- the
 * same trade the Services module already makes there (utils/withTransaction.js).
 * Replica sets (Quick Drop's Atlas cluster) are untouched and keep full
 * transactions. The durable fix is a single-node replica set on that server.
 */
let patched = false;

export async function adaptTransactionsToTopology(connection = mongoose.connection) {
  if (patched) return { standalone: true, patched: true };
  const hello = await connection.db.admin().command({ hello: 1 }).catch(() => null);
  if (!hello) return { standalone: false, patched: false };
  const standalone = !hello.setName && hello.msg !== 'isdbgrid';
  if (!standalone) return { standalone: false, patched: false };

  const ClientSession = mongoose.mongo.ClientSession;
  const proto = ClientSession?.prototype;
  if (!proto) return { standalone: true, patched: false };

  proto.startTransaction = function startTransactionNoop() {};
  proto.commitTransaction = async function commitTransactionNoop() {};
  proto.abortTransaction = async function abortTransactionNoop() {};
  proto.withTransaction = async function withTransactionNoop(fn) {
    return fn(this);
  };
  patched = true;
  logger.warn(
    '[db] MongoDB is a standalone server: transactions are disabled and multi-document '
    + 'writes run without rollback. Convert it to a single-node replica set to restore them.',
  );
  return { standalone: true, patched: true };
}
