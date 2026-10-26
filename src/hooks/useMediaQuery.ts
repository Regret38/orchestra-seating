import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** 휴대폰·태블릿 레이아웃 */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 899px)');
}

/** 손가락(터치)이 주 입력 장치인지 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
