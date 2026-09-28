import { mapDatabaseError } from './all-exceptions.filter';
import { AppError } from './app-error';

/**
 * Runs a hard delete. If PostgreSQL refuses it because history or other
 * records still reference the row (RESTRICT foreign keys), explains that the
 * record must be disabled instead.
 */
export async function deleteUnlessInUse<T>(run: () => Promise<T>, what: string): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (mapDatabaseError(e)?.code === 'INVALID_STATE') {
      throw AppError.invalidState(`لا يمكن حذف ${what} لأنه مستخدم أو مرتبط بالتاريخ. يمكنك تعطيله بدلًا من ذلك.`);
    }
    throw e;
  }
}
