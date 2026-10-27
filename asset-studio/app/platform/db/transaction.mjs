/**
 * 同步事务边界。所有仓储都是同步的（node:sqlite），所以用例里的多步写入可以放进一个事务。
 */
export function createTransaction(db) {
  if (!db) throw new Error('事务需要数据库连接');
  return function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 回滚失败时保留原始错误 */
      }
      throw error;
    }
  };
}
