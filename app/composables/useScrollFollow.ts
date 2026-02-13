import { computed, onUnmounted, ref, type Ref, watch } from 'vue';
export type ScrollMode = 'follow' | 'force' | 'manual' | 'none';
const BOTTOM_THRESHOLD_PX = 8;
const SCROLL_SPEED_PX_PER_MS = 1.5;
const INTERVENTION_TOLERANCE_PX = 2;
const MAX_FRAME_DT_MS = 50;
const NATIVE_SMOOTH_TIMEOUT_MS = 1_500;
type SmoothEngine = 'raf' | 'native';
type ScrollFollowOptions = { bottomThresholdPx?: number; observeDelayMs?: number; smoothEngine?: SmoothEngine; smoothOnMutation?: boolean; smoothOnInitialFollow?: boolean; enabled?: boolean };
const FOLLOW_DEBUG = (typeof window !== 'undefined' && (window as any).__VIS_FOLLOW_DEBUG__) || false;

function followDebug(event: string, detail?: Record<string, unknown>) {
  if (!FOLLOW_DEBUG) return;
  const t = typeof performance !== 'undefined' ? Number(performance.now().toFixed(1)) : 0;
  if (detail) return void console.debug(`[follow] ${event}`, { t, ...detail });
  console.debug(`[follow] ${event}`, { t });
}
export function useScrollFollow(containerEl: Ref<HTMLElement | undefined>, scrollMode: Ref<ScrollMode>, options: ScrollFollowOptions = {}) {
  const bottomThresholdPx = options.bottomThresholdPx ?? BOTTOM_THRESHOLD_PX;
  const smoothEngine = options.smoothEngine ?? 'raf';
  const smoothOnMutation = options.smoothOnMutation ?? true;
  const smoothOnInitialFollow = options.smoothOnInitialFollow ?? true;
  const isFollowing = ref(scrollMode.value === 'follow' || scrollMode.value === 'force');
  const isTrackingPaused = ref(options.enabled === false);
  let resizeObserver: ResizeObserver | null = null;
  let rafId: number | null = null;
  let animating = false;
  let lastSetScrollTop = -1;
  let nativeSmoothMonitorTimeout: ReturnType<typeof setTimeout> | null = null;
  let nativeSmoothCleanup: (() => void) | null = null;
  let contentChangeScheduled = false;
  let queuedAutoScrollSmooth = false;
  let userScrollingUp = false;
  let lastTouchY: number | null = null;
  const showResumeButton = computed(() => scrollMode.value === 'follow' && !isFollowing.value);
  const isAtBottom = (el: HTMLElement): boolean => el.scrollHeight - el.scrollTop - el.clientHeight <= bottomThresholdPx;
  function cancelAnimation() {
    animating = false;
    lastSetScrollTop = -1;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }
  const pauseTracking = () => {
    isTrackingPaused.value = true;
    followDebug('pauseTracking');
  };
  function resumeTracking(options: { syncToBottom?: boolean } = {}) {
    followDebug('resumeTracking:start', { wasPaused: isTrackingPaused.value, syncToBottom: Boolean(options.syncToBottom), isFollowing: isFollowing.value });
    if (!isTrackingPaused.value) return void (options.syncToBottom ? scrollToBottom(false) : followDebug('resumeTracking:already-active'));
    if (options.syncToBottom) {
      scrollToBottom(false);
      isTrackingPaused.value = false;
      return;
    }
    isTrackingPaused.value = false;
    const el = containerEl.value;
    if (scrollMode.value === 'follow' && el && isAtBottom(el)) isFollowing.value = true;
    followDebug('resumeTracking:done', { isFollowing: isFollowing.value, atBottom: el ? isAtBottom(el) : null });
  }
  function runWithoutTracking<T>(fn: () => T): T {
    const wasPaused = isTrackingPaused.value;
    isTrackingPaused.value = true;
    try { return fn(); } finally { if (!wasPaused) resumeTracking(); }
  }
  function clearNativeSmoothMonitor() {
    if (nativeSmoothMonitorTimeout !== null) clearTimeout(nativeSmoothMonitorTimeout);
    nativeSmoothMonitorTimeout = null;
    const cleanup = nativeSmoothCleanup;
    nativeSmoothCleanup = null;
    cleanup?.();
  }
  function startNativeSmoothMonitor(el: HTMLElement) {
    clearNativeSmoothMonitor();
    pauseTracking();
    let done = false;
    const onScrollEnd = () => finish();
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('scrollend', onScrollEnd as EventListener);
      if (nativeSmoothMonitorTimeout !== null) clearTimeout(nativeSmoothMonitorTimeout);
      nativeSmoothMonitorTimeout = null;
      nativeSmoothCleanup = null;
      resumeTracking();
      isFollowing.value = true;
    };
    el.addEventListener('scrollend', onScrollEnd as EventListener);
    nativeSmoothMonitorTimeout = setTimeout(finish, NATIVE_SMOOTH_TIMEOUT_MS);
    nativeSmoothCleanup = finish;
  }
  function scrollToBottom(smooth: boolean) {
    const el = containerEl.value;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (target <= 0 || Math.abs(el.scrollTop - target) < 1) return;
    followDebug('scrollToBottom:start', { smooth, from: el.scrollTop, target, isFollowing: isFollowing.value });
    if (!smooth) {
      clearNativeSmoothMonitor();
      cancelAnimation();
      el.scrollTop = target;
      lastSetScrollTop = target;
      followDebug('scrollToBottom:jump', { top: el.scrollTop, target });
      return;
    }
    if (smoothEngine === 'native') {
      cancelAnimation();
      startNativeSmoothMonitor(el);
      el.scrollTo({ top: target, behavior: 'smooth' });
      lastSetScrollTop = target;
      return;
    }
    clearNativeSmoothMonitor();
    if (animating) return;
    animating = true;
    let lastTime = performance.now();
    lastSetScrollTop = el.scrollTop;
    const frame = (now: number) => {
      const current = containerEl.value;
      if (!current || !animating) return void (animating = false);
      if (lastSetScrollTop >= 0 && Math.abs(current.scrollTop - lastSetScrollTop) > INTERVENTION_TOLERANCE_PX) {
        animating = false;
        lastSetScrollTop = -1;
        followDebug('scrollToBottom:intervened', { top: current.scrollTop });
        return;
      }
      const dt = Math.min(now - lastTime, MAX_FRAME_DT_MS);
      lastTime = now;
      const nextTarget = current.scrollHeight - current.clientHeight;
      const remaining = nextTarget - current.scrollTop;
      if (remaining <= 0.5) {
        current.scrollTop = nextTarget;
        lastSetScrollTop = nextTarget;
        animating = false;
        followDebug('scrollToBottom:raf-complete', { top: current.scrollTop, target: nextTarget });
        return;
      }
      const newTop = Math.min(current.scrollTop + SCROLL_SPEED_PX_PER_MS * dt, nextTarget);
      current.scrollTop = newTop;
      lastSetScrollTop = newTop;
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }
  function scheduleAutoScroll(smooth: boolean) {
    queuedAutoScrollSmooth ||= smooth;
    if (contentChangeScheduled) return void followDebug('scheduleAutoScroll:skip-queued', { smooth });
    contentChangeScheduled = true;
    followDebug('scheduleAutoScroll:queued', { smooth, mode: scrollMode.value, isFollowing: isFollowing.value });
    requestAnimationFrame(() => {
      contentChangeScheduled = false;
      const smoothToUse = queuedAutoScrollSmooth;
      queuedAutoScrollSmooth = false;
      followDebug('scheduleAutoScroll:run', { smooth: smoothToUse, mode: scrollMode.value, isFollowing: isFollowing.value });
      scrollToBottom(smoothToUse);
    });
  }
  function notifyContentChange() {
    const mode = scrollMode.value;
    if (isTrackingPaused.value) return void followDebug('notifyContentChange:skip-paused');
    if (mode !== 'follow' && mode !== 'force') return void followDebug('notifyContentChange:skip-mode', { mode });
    if (!isFollowing.value) return void followDebug('notifyContentChange:skip-unlocked', { mode });
    scheduleAutoScroll(smoothOnMutation);
  }
  function onScroll() {
    if (isTrackingPaused.value || animating) return void (userScrollingUp = false);
    const el = containerEl.value;
    if (!el) return void (userScrollingUp = false);
    const atBottom = isAtBottom(el);
    followDebug('onScroll', { top: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom, userScrollingUp, isFollowingBefore: isFollowing.value });
    if (atBottom) {
      isFollowing.value = true;
      followDebug('onScroll:setFollowing', { isFollowing: true, reason: 'at-bottom' });
    } else if (userScrollingUp && scrollMode.value === 'follow') {
      isFollowing.value = false;
      followDebug('onScroll:setFollowing', { isFollowing: false, reason: 'scroll-up' });
    }
    userScrollingUp = false;
  }
  const onWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) {
      userScrollingUp = true;
      followDebug('userScrollIntent', { source: 'wheel' });
    }
  };
  const onTouchStart = (event: TouchEvent) => {
    lastTouchY = event.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (event: TouchEvent) => {
    const touchY = event.touches[0]?.clientY;
    if (touchY === undefined) return;
    if (lastTouchY !== null && touchY < lastTouchY) {
      userScrollingUp = true;
      followDebug('userScrollIntent', { source: 'touchmove' });
    }
    lastTouchY = touchY;
  };
  const onTouchEnd = () => {
    lastTouchY = null;
  };
  const onContainerResize = () => {
    if (isTrackingPaused.value) return;
    followDebug('onContainerResize', { mode: scrollMode.value, isFollowing: isFollowing.value });
    if (isFollowing.value) scrollToBottom(false);
  };
  const resumeFollow = (smooth = true) => {
    isFollowing.value = true;
    followDebug('resumeFollow', { smooth });
    scrollToBottom(smooth);
  };
  function setup(el: HTMLElement) {
    followDebug('setup', { top: el.scrollTop });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    resizeObserver = new ResizeObserver(onContainerResize);
    resizeObserver.observe(el);
    if (scrollMode.value === 'follow' || scrollMode.value === 'force') scrollToBottom(smoothOnInitialFollow);
  }
  function teardown(el: HTMLElement) {
    followDebug('teardown', { top: el.scrollTop });
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
    el.removeEventListener('touchcancel', onTouchEnd);
    resizeObserver?.disconnect();
    resizeObserver = null;
    userScrollingUp = false;
    lastTouchY = null;
    clearNativeSmoothMonitor();
    cancelAnimation();
  }
  watch(containerEl, (newEl, oldEl) => {
    if (oldEl) teardown(oldEl);
    if (newEl) setup(newEl);
  });
  watch(scrollMode, (m) => {
    if (m === 'follow' || m === 'force') {
      isFollowing.value = true;
      if (containerEl.value) scrollToBottom(smoothOnInitialFollow);
    }
  });
  onUnmounted(() => {
    if (containerEl.value) teardown(containerEl.value);
    clearNativeSmoothMonitor();
    cancelAnimation();
  });
  return { isTrackingPaused: computed(() => isTrackingPaused.value), isFollowing: computed(() => isFollowing.value), showResumeButton, pauseTracking, resumeTracking, runWithoutTracking, resumeFollow, scrollToBottom, notifyContentChange };
}
