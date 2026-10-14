// =====================================================================
// pages/lists/useSinkHold.js：勾完的「先留一会儿，再沉下去」。
//
// 勾选是立刻写进数据的（乐观更新、离线也行），但行的位置先不动：刚勾的行留在手指下面，对勾和划线播完，
// 连着勾好几项也不会一勾就跳走、点错下一行。最后一次勾选之后 SINK_DELAY_MS 毫秒没再勾，所有刚勾的一起
// FLIP 沉到「已完成」（取消勾选的一起浮上来），然后 onRelease 收到这一批（页面据此弹「已装好 3 件 · 撤销」）。
//
//   const sink = useSinkHold({ onRelease: (batch) => … });
//   sink.mark(todo, nextDone)      // 勾 / 取消勾的时候调（在改数据之前调：todo.done 还是勾之前的状态）
//   sink.hold                      // Map<id, 勾之前的状态>：model.js 的 splitRows 按它排
//   sink.flush()                   // 马上沉（换标签、换筛选前）
//   sink.pressStart() / pressEnd()  // 列表上有手指按着：先别沉（沉的那一刻手指下面的行换了，这一下会丢），松手 PRESS_GRACE_MS 后再沉
// mark / flush 每次渲染都是同一个函数（可以放进 useMemo 的依赖）。
//
// 在同一个等待期里勾了又取消（反悔）：这一行回到原来的状态，不进这一批。
// =====================================================================

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

/** 最后一次勾选之后等多久再沉（对勾描线 + 划线大约 0.5 秒，多留一点给连续勾选） */
export const SINK_DELAY_MS = 900;
/** 手指按着列表时到点了：松手后再等这么久才沉（交互评审 P1-3 附带：沉底那一刻按下的那一下会丢） */
export const PRESS_GRACE_MS = 300;

/**
 * @param {{ onRelease?: (batch: Array<{ id: string, title: string, list: string, from: boolean, to: boolean }>) => void, delay?: number }} o
 */
export function useSinkHold({ onRelease, delay = SINK_DELAY_MS } = {}) {
  const [hold, setHold] = useState(() => new Map());
  const pending = useRef(new Map());
  const timer = useRef(0);
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const delayRef = useRef(delay);
  delayRef.current = delay;

  const pressing = useRef(0);
  const deferred = useRef(false);

  const api = useMemo(() => {
    const flush = () => {
      clearTimeout(timer.current);
      timer.current = 0;
      deferred.current = false;
      const batch = [...pending.current.values()].filter((x) => x.from !== x.to);
      pending.current = new Map();
      setHold((h) => (h.size ? new Map() : h));
      if (batch.length) releaseRef.current?.(batch);
    };
    const mark = (todo, nextDone) => {
      const id = todo.id;
      const was = pending.current.get(id);
      const from = was ? was.from : Boolean(todo.done);
      const to = Boolean(nextDone);
      if (from === to) pending.current.delete(id);
      else pending.current.set(id, { id, title: todo.title, list: todo.list, from, to });
      setHold((h) => {
        const m = new Map(h);
        if (from === to) m.delete(id);
        else m.set(id, from);
        return m;
      });
      clearTimeout(timer.current);
      timer.current = setTimeout(due, delayRef.current);
    };
    // 到点了：有手指按着就先记下，等松手
    const due = () => {
      timer.current = 0;
      if (pressing.current > 0) {
        deferred.current = true;
        return;
      }
      flush();
    };
    const pressStart = () => {
      pressing.current += 1;
    };
    const pressEnd = () => {
      pressing.current = Math.max(0, pressing.current - 1);
      if (pressing.current === 0 && deferred.current && pending.current.size) {
        deferred.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(due, PRESS_GRACE_MS);
      }
    };
    return { mark, flush, pressStart, pressEnd, isPending: () => pending.current.size > 0 };
  }, []);

  // 离开页面：不等了，也不弹提示（人已经不在这一页）
  useEffect(() => () => {
    clearTimeout(timer.current);
    pending.current = new Map();
  }, []);

  return { hold, ...api };
}
