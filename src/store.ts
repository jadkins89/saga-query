import type { Reducer, Middleware } from 'redux';
import { combineReducers } from 'redux';
import type { Saga, Task } from 'redux-saga';
import createSagaMiddleware, { stdChannel } from 'redux-saga';
import { enableBatching, BATCH } from 'redux-batched-actions';

import type { ActionWithPayload } from './types';
import type { QueryState } from './slice';
import { reducers as sagaQueryReducers } from './slice';

import { call, spawn, all, ForkEffectDescriptor } from 'redux-saga/effects';
import { CombinatorEffect, SimpleEffect } from '@redux-saga/types';

function defaultOnError(err: Error) {
  console.error(err);
}

function* keepAlive(
  saga: (...args: any[]) => any,
  onError: (err: Error) => any = defaultOnError,
  options: any[],
) {
  while (true) {
    try {
      // @ts-ignore
      yield call(saga, ...options);
      break;
    } catch (err) {
      if (typeof onError === 'function') {
        yield call(onError as any, err);
      }
    }
  }
}

/**
 * A fault tolerant saga.
 */
export function sagaCreator(
  sagas: {
    [key: string]: (...args: any[]) => any;
  },
  onError?: (err: Error) => any,
): (
  ...options: any[]
) => Generator<
  CombinatorEffect<'ALL', SimpleEffect<'FORK', ForkEffectDescriptor<void>>>,
  void,
  unknown
> {
  return function* rootSaga(...options: any[]) {
    yield all(
      Object.values(sagas).map((saga) =>
        spawn(keepAlive, saga, onError, options),
      ),
    );
  };
}

export interface PrepareStore<
  S extends { [key: string]: any } = { [key: string]: any },
> {
  reducer: Reducer<S & QueryState>;
  middleware: Middleware<any, S, any>[];
  run: (...args: any[]) => Task;
}

interface Props<S extends { [key: string]: any } = { [key: string]: any }> {
  reducers: { [key in keyof S]: Reducer<S[key]> };
  sagas: { [key: string]: Saga<any> };
  onError?: (err: Error) => void;
}

/**
 * This will setup `redux-batched-actions` to work with `redux-saga`.
 * It will also add some reducers to your `redux` store for decoupled loaders
 * and a simple data cache.
 *
 * @example
 * ```ts
 * import { prepareStore } from 'saga-query';
 *
 * const { middleware, reducer, run } = prepareStore({
 *  reducers: { users: (state, action) => state },
 *  sagas: { api: api.saga() },
 *  onError: (err) => console.error(err),
 * });
 *
 * const store = createStore(reducer, {}, applyMiddleware(...middleware));
 *
 * // you must call `.run(...args: any[])` in order for the sagas to bootup.
 * run();
 * ```
 */
export function prepareStore<
  S extends { [key: string]: any } = { [key: string]: any },
>({
  reducers = {} as any,
  sagas,
  onError = console.error,
}: Props<S>): PrepareStore<S> {
  const middleware: Middleware<any, S, any>[] = [];

  const channel = stdChannel();
  const rawPut = channel.put;
  channel.put = (action: ActionWithPayload<any>) => {
    if (action.type === BATCH) {
      action.payload.forEach(rawPut);
      return;
    }
    rawPut(action);
  };

  const sagaMiddleware = createSagaMiddleware({ channel } as any);
  middleware.push(sagaMiddleware);

  const reducer = combineReducers({ ...sagaQueryReducers, ...reducers });
  const rootReducer: any = enableBatching(reducer);
  const rootSaga = sagaCreator(sagas, onError);
  const run = (...args: any[]) => sagaMiddleware.run(rootSaga, ...args);

  return { middleware, reducer: rootReducer, run };
}
