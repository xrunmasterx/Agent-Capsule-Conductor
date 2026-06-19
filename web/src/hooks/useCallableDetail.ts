import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import type { CallableDetail } from '../types';

export type CallableDetailLoadState = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  detail: CallableDetail | null;
  error: string;
};

export function useCallableDetail(callableId: string): CallableDetailLoadState {
  const cacheRef = useRef<Record<string, CallableDetail>>({});
  const [state, setState] = useState<CallableDetailLoadState>({
    status: callableId ? 'loading' : 'idle',
    detail: null,
    error: '',
  });

  useEffect(() => {
    let ignore = false;
    if (!callableId) {
      setState({ status: 'idle', detail: null, error: '' });
      return () => {
        ignore = true;
      };
    }
    const cached = cacheRef.current[callableId];
    if (cached) {
      setState({ status: 'loaded', detail: cached, error: '' });
      return () => {
        ignore = true;
      };
    }
    setState({ status: 'loading', detail: null, error: '' });
    api
      .callable(callableId)
      .then((payload) => {
        if (ignore) {
          return;
        }
        cacheRef.current[callableId] = payload.callable;
        setState({ status: 'loaded', detail: payload.callable, error: '' });
      })
      .catch((error) => {
        if (!ignore) {
          setState({
            status: 'error',
            detail: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [callableId]);

  return state;
}
