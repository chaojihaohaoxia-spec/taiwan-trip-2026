// =====================================================================
// sheets/photo-import/PhotoImportSheet.jsx：弹层「photo-import」——补照片（按拍摄日期分到每天）。
//
// 打开：sheets/index.js 的 openPhotoImport()；页面上更顺手的是先选照片再开（iOS 只认真实点击上的 <input type=file>）：
//   <PhotoInput multiple onFiles={importPhotosWith}>从相册挑照片</PhotoInput>
//
//   1. 还没选：一句说明 +「从相册挑照片」（多选）；
//   2. 读拍摄时间（EXIF，不解码图片，很快）→ 按照片自己的当地日期分到每天：
//        D1 · 10月16日 周五        12 张
//             09:12–21:40
//      已经在日记里的（同一刻拍的）跳过，不是这几天拍的跳过；没有拍摄时间的（截图、微信转来的）可以挑一天放，默认不放；
//   3. 「放进日记」：一张一张压缩、进写队列（离线也行，联网后自动传），一天传完就存一次那天**我的**日记（task.js）。
//      面板关了也接着做完，做完弹一条提示；开着的话显示进度，做完「去相册看看」。
// 不显示原图缩略图：几十张 1200 万像素的原图同时解码，iPhone 会因为内存被系统关掉。
// =====================================================================

import './photo-import.css';
import { useMemo, useState } from 'preact/hooks';
import { Sheet, closeOverlay, isOverlayOpen, toast } from '../../overlay/index.js';
import { SubmitButton } from '../../ui/SubmitButton.jsx';
import { Button } from '../../ui/Button.jsx';
import { Chip } from '../../ui/Chip.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { DayBadge } from '../../kit/DayBadge.jsx';
import { authState } from '../../data/index.js';
import { navigate } from '../../router/index.js';
import { readImageExif } from '../../lib/image.js';
import { formatDate } from '../../lib/datetime.js';
import { haptic } from '../../lib/native.js';
import { PhotoInput } from '../journal/PhotoInput.jsx';
import { useSheetTrip } from '../hooks.js';
import { planImport, planSummary, rangeText } from './model.js';
import { takeImport, runImport, importTask } from './task.js';

export default function PhotoImportSheet() {
  const { tripId, store, pending } = useSheetTrip();
  const me = authState.value.user?.id || null;
  const days = store?.view.days.value || [];
  const timeZone = store?.trip.value?.timezone;
  const byDay = store?.view.journalByDay.value;
  /** 'pick' | 'reading' | 'plan' | 'done' */
  const [phase, setPhase] = useState('pick');
  /** key → { file, local, iso } */
  const [files, setFiles] = useState(() => new Map());
  const [unknownDay, setUnknownDay] = useState(null);
  const [result, setResult] = useState(null);
  const task = importTask.value;
  const busy = task?.state === 'running' && task.tripId === tripId;

  const read = async (list) => {
    if (!list?.length) return;
    setPhase('reading');
    const next = new Map();
    let i = 0;
    for (const file of list) {
      // 一张一张读（只读文件头几十 KB），读完给界面喘口气
      const { takenAt } = await readImageExif(file, { timeZone });
      next.set(`f${i}`, { file, local: takenAt?.local || null, iso: takenAt?.iso || null, sig: `${file.name || ''}|${file.size || 0}|${file.lastModified || 0}` });
      i += 1;
    }
    setFiles(next);
    setUnknownDay(null);
    setFrozen(null);
    setResult(null);
    setPhase('plan');
  };

  const existing = useMemo(() => {
    const m = new Map();
    // 只和我自己的日记比（照片只会放进我的日记；对方同一秒拍的另一张不算重复，代码评审 P2）
    for (const d of days) m.set(d.id, (byDay?.get(d.id) || []).filter((e) => e.user_id === me).flatMap((e) => e.photos || []));
    return m;
  }, [days, byDay, me]);

  // 「放进日记」那一刻的分法定下来（放完以后日记里已经有这些照片，再算一遍会全变成「已经有了」）
  const [frozen, setFrozen] = useState(null);
  const live = useMemo(() => (phase === 'plan'
    ? planImport({ photos: [...files].map(([key, f]) => ({ key, local: f.local, iso: f.iso, sig: f.sig })), days, existing, unknownDay })
    : null), [phase, files, days, existing, unknownDay]);
  const plan = frozen || live;

  const reset = () => {
    if (busy) return;
    setPhase('pick');
    setFiles(new Map());
    setUnknownDay(null);
    setResult(null);
    setFrozen(null);
  };

  const start = async () => {
    if (!store || !me || !plan?.count) throw new Error('没有能放的照片');
    haptic('light');
    setFrozen(plan);
    const r = await runImport(store, plan, files, me);
    setResult(r);
    if (!r.done) {
      setFrozen(null);
      throw new Error('照片都没有处理成功');
    }
    haptic('success');
    if (!isOverlayOpen('photo-import')) toast.success(`补好了：${r.done} 张照片放进 ${r.days} 天的日记`);
  };

  const footer = phase === 'plan' || phase === 'done' ? (
    <div class="pim-foot">
      {busy && (
        <p class="pim-progress" role="status" data-testid="photo-import-progress">
          <span class="pim-progress__bar" aria-hidden="true"><i style={{ '--pim-ratio': task.total ? (task.done + task.failed) / task.total : 0 }} /></span>
          <span>正在处理 {task.done + task.failed} / {task.total}，关掉面板也会接着做完</span>
        </p>
      )}
      {phase === 'done' ? (
        <Button
          block
          size="lg"
          onClick={() => {
            closeOverlay('photo-import', { force: true });
            navigate({ name: 'journal', params: { tripId }, query: { view: 'album' } });
          }}
          data-testid="photo-import-open-album"
        >
          去相册看看
        </Button>
      ) : (
        <SubmitButton
          block
          label={plan?.count ? `放进日记 · ${plan.count} 张` : '没有能放的照片'}
          loadingLabel="正在放"
          successLabel="放好了"
          errorLabel="重试"
          disabled={!plan?.count}
          resetAfter={false}
          action={start}
          onSuccess={() => setPhase('done')}
          data-testid="photo-import-submit"
        />
      )}
    </div>
  ) : null;

  return (
    <Sheet
      sheetId="photo-import"
      title="补照片"
      detents={['content', 'large']}
      footer={footer}
      onOpened={() => {
        const stashed = takeImport();
        if (stashed.length) read(stashed);
      }}
      onClosed={reset}
      testId="sheet-photo-import"
    >
      <div class="pim" data-phase={phase}>
        {(pending || !store) && phase === 'pick' ? (
          <p class="pim-note"><Spinner size={16} /> 正在读取行程…</p>
        ) : phase === 'pick' ? (
          <div class="pim-pick">
            <p class="pim-lead">挑这趟拍的照片，按日期自动放进每天。</p>
            <PhotoInput multiple block size="lg" variant="primary" onFiles={read} testId="photo-import-pick">从相册挑照片</PhotoInput>
            <p class="pim-fine">照片会压缩到长边 2048、去掉位置信息，放进你自己那天的日记。已经放过的不会重复。</p>
          </div>
        ) : phase === 'reading' ? (
          <p class="pim-note" role="status"><Spinner size={16} /> 正在看拍摄时间…</p>
        ) : (
          <PlanView plan={plan} noTime={[...files.values()].filter((f) => !f.local).length} days={days} timeZone={timeZone} unknownDay={unknownDay} setUnknownDay={setUnknownDay} done={phase === 'done'} result={result} />
        )}
      </div>
    </Sheet>
  );
}

function PlanView({ plan, noTime, days, timeZone, unknownDay, setUnknownDay, done, result }) {
  if (!plan) return null;
  return (
    <div class="pim-plan" data-testid="photo-import-plan">
      <p class="pim-lead" data-testid="photo-import-summary">
        {done && result ? `放好了：${result.done} 张照片放进 ${result.days} 天的日记${result.failed ? `，${result.failed} 张打不开` : ''}。` : planSummary(plan) || '这些照片都放不进来。'}
      </p>
      {plan.groups.length > 0 && (
        <ul class="pim-days">
          {plan.groups.map((g) => (
            <li key={g.day.id} class="pim-day" data-testid={`photo-import-day-${g.day.date}`}>
              <DayBadge n={g.n} size="md" class="pim-day__badge" />
              <span class="pim-day__text">
                <b>{formatDate(g.day.date, { timeZone })}</b>
                {rangeText(g) && <span>{rangeText(g)}</span>}
              </span>
              <span class="pim-day__count tabular-nums">{g.keys.length} 张</span>
            </li>
          ))}
        </ul>
      )}
      {!done && noTime > 0 && (
        <div class="pim-unknown" data-testid="photo-import-unknown">
          <p class="pim-unknown__title"><Glyph name="info" size={15} />{noTime} 张没有拍摄时间（截图、聊天里转来的图常常这样），放到：</p>
          <div class="pim-unknown__chips" role="group" aria-label="没有拍摄时间的照片放到哪天">
            <Chip size="sm" selected={!unknownDay} onToggle={() => setUnknownDay(null)}>不放</Chip>
            {days.map((d, i) => (
              <Chip key={d.id} size="sm" selected={unknownDay === d.id} onToggle={() => { haptic('selection'); setUnknownDay(d.id); }}>D{i + 1}</Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
