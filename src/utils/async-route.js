// @ts-check

/**
 * @template TReq
 * @template TRes
 * @param {(req: TReq, res: TRes, next: (error?: unknown) => void) => unknown | Promise<unknown>} handler
 */
export function asyncRoute(handler) {
  /**
   * @param {TReq} req
   * @param {TRes} res
   * @param {(error?: unknown) => void} next
   */
  return function asyncRouteHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
