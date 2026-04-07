import { Request, Response, NextFunction } from 'express';

export type AsyncNext = NextFunction;

export type AsyncRouteHandler<TReq = Request, TRes = Response> = (
  req: TReq,
  res: TRes,
  next: AsyncNext
) => unknown | Promise<unknown>;

export function asyncRoute<TReq = Request, TRes = Response>(
  handler: AsyncRouteHandler<TReq, TRes>
): (req: TReq, res: TRes, next: AsyncNext) => void {
  return function asyncRouteHandler(req: TReq, res: TRes, next: AsyncNext): void {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
