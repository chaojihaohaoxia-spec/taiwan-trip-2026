// =====================================================================
// pages/settings/SettingsPage.jsx：设置（路由 settings，#/settings；SPEC §5.12）。
//
// 外壳画左上返回、大标题「设置」（settings 外框：没有底栏、没有搜索），这一页只放内容，从上到下：
//   1. 账号：头像、名字、邮箱（离线时说明）、「退出登录」（有没同步的改动先确认，account.js）；
//   2. 旧版本机记录（这台设备上有旧版的键才出现，LegacyImport.jsx）：明文 AI 密钥一键删除；台湾行程的本机记录预览并导入；
//   3. 每趟行程（成员和邀请）：每趟一张可以原地展开的卡（Members.jsx）：能编辑的成员先看到日期（改日期面板 TripDates.jsx）、
//      这趟怎么走、叫车用、只有自己时拉对方进来（TripPrefs.jsx）；创建者能邀请（invite 弹层）、改权限、移出；
//   4. 外观：自动 / 浅色 / 深色（分段控件，指示块弹簧跟随；lib/theme.js）；
//   5. 这台设备：同步状态（重试 / 放弃没保存上的改动）、网络、本机存储（syncStatus.storage）、本机占用和「长期保存」
//      （navigator.storage；iOS 不加到主屏的网页 7 天不用会被清掉）；
//   6. 关于：版本号、离线可用、「检查更新」（lib/pwa.js；有新版本就「立即更新」）、字体授权（随站部署的 fonts/licenses/）、签名。
// 状态：行程列表加载中（成员那一段显示骨架，其余照常）；离线（同步一节说明，邀请等要联网的操作在弹层里说明）；深色；375 / 1280。
// =====================================================================

import './settings.css';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useMyTrips, sortTripsForList, authState, syncStatus, online, data } from '../../data/index.js';
import { appVersion, APP_NAME } from '../../lib/env.js';
import { themePreference, setThemePreference } from '../../lib/theme.js';
import { swControlled, updateReady, checkForUpdate, applyUpdate } from '../../lib/pwa.js';
import { openExternal, haptic } from '../../lib/native.js';
import { now } from '../../lib/clock.js';
import { SegmentedControl } from '../../ui/SegmentedControl.jsx';
import { Button } from '../../ui/Button.jsx';
import { Avatar } from '../../ui/Avatar.jsx';
import { Skeleton } from '../../ui/Skeleton.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Card, InfoRow, SectionHeader, Glyph } from '../../kit/index.js';
import { confirm, toast } from '../../overlay/index.js';
import { lastTripId } from '../../shell/trip-state.js';
import { signOutFlow } from './account.js';
import { MembersSection } from './Members.jsx';
import { LegacyCards, LegacyImportSheet, useLegacyScan } from './LegacyImport.jsx';
import { TripDatesSheet } from './TripDates.jsx';
import { formatBytes, storageLabel, syncTone, FONT_LICENSES, versionParts } from './model.js';
import { memberColor } from '../../kit/RatingChips.jsx';

const THEMES = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export default function SettingsPage() {
  const list = useMyTrips();
  const entries = useMemo(() => sortTripsForList(list.entries || [], now()), [list.entries]);
  const scan = useLegacyScan();
  const ready = list.status === 'ready' || entries.length > 0;
  const last = lastTripId();
  const currentId = entries.some((e) => e.id === last) ? last : entries[0]?.id || null;

  return (
    <div class="settings" data-testid="page-settings">
      <AccountCard color={myColor(entries)} />
      <LegacyCards scan={scan} />

      <SectionHeader title="每趟行程" meta="日期、怎么走、成员和邀请" />
      {ready ? (
        <MembersSection entries={entries} currentId={currentId} />
      ) : list.status === 'error' ? (
        <p class="set-note set-note--warning" role="status" data-testid="settings-members-error">
          {list.error?.message || '行程列表没有读出来'}
          <button type="button" class="set-note__btn" data-press="scale" onClick={() => data.trips.load({ fresh: true })}>重试</button>
        </p>
      ) : (
        <div class="set-trips" aria-busy="true">
          <span class="visually-hidden" role="status">正在读取行程…</span>
          {[0, 1].map((i) => <div key={i} class="set-skel material-card"><Skeleton variant="circle" size={32} /><Skeleton variant="text" width="55%" /></div>)}
        </div>
      )}

      <SectionHeader title="外观" />
      <Card padding="sm" class="set-card" testId="settings-appearance">
        <SegmentedControl block label="外观" options={THEMES} value={themePreference.value} onChange={(v) => { haptic('selection'); setThemePreference(v); }} data-testid="settings-theme" />
        <p class="set-hint">「自动」跟着手机走。</p>
      </Card>

      <SectionHeader title="这台设备" />
      <DeviceCard />

      <SectionHeader title="关于" />
      <AboutCard />

      <p class="set-sign" data-testid="settings-sign">{APP_NAME} · Jeremy &amp; Cathy</p>
      <LegacyImportSheet entries={entries} scan={scan} />
      <TripDatesSheet />
    </div>
  );
}

/** 我的颜色：成员数据里的颜色（同一个人在成员芯片、评级、头像里一个颜色；取最近一趟行程里我的那一行） */
function myColor(entries) {
  const m = (entries || []).find((e) => e.member?.color)?.member || null;
  return m ? memberColor(m) : undefined;
}

function AccountCard({ color }) {
  const auth = authState.value;
  const user = auth.user;
  const [busy, setBusy] = useState(false);
  const out = async () => {
    setBusy(true);
    try {
      await signOutFlow();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card glyph="user" title="账号" testId="settings-account">
      <div class="set-account">
        {user ? <Avatar name={user.displayName || user.email} size="lg" color={color} decorative /> : <Skeleton variant="circle" size={56} />}
        <span class="set-account__text">
          <b data-testid="account-name">{user ? user.displayName || user.email : '正在恢复登录…'}</b>
          {user?.email && <span>{user.email}</span>}
          {auth.offline && <span class="set-account__off">离线中：先用这台设备上存着的登录，联网后自动确认</span>}
        </span>
      </div>
      {user && (
        <Button variant="secondary" block disabled={busy} onClick={out} leading={busy ? <Spinner size={18} /> : null} data-testid="sign-out">
          {busy ? '正在同步改动后退出…' : '退出登录'}
        </Button>
      )}
      <p class="set-hint">只退出这台设备，没同步的改动会先传上去。</p>
    </Card>
  );
}

function DeviceCard() {
  const s = syncStatus.value || {};
  const isOnline = online.value !== false;
  const [est, setEst] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let alive = true;
    const st = typeof navigator !== 'undefined' ? navigator.storage : null;
    st?.estimate?.().then((v) => alive && setEst(v)).catch(() => {});
    st?.persisted?.().then((v) => alive && setPersisted(v)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const retry = async () => {
    setBusy('retry');
    try {
      await data.retrySync();
    } finally {
      setBusy('');
    }
  };
  const discard = async () => {
    const ok = await confirm({
      title: '放弃没保存上的改动？',
      message: `${s.failed?.label ? `「${s.failed.label}」` : '这条改动'}会被丢掉，界面回到服务器上的样子。`,
      confirmText: '放弃',
      cancelText: '再试试',
      destructive: true,
    });
    if (ok) await data.discardFailed();
  };
  const persist = async () => {
    setBusy('persist');
    try {
      const ok = await navigator.storage.persist();
      setPersisted(ok);
      if (ok) toast.success('已设为长期保存');
      else toast.warning('这台设备没有同意长期保存：把网站加到主屏幕以后再试');
    } catch {
      toast.warning('这台设备不支持设置长期保存');
    } finally {
      setBusy('');
    }
  };
  const store = storageLabel(s.storage);
  return (
    <Card padding="sm" class="set-card" testId="settings-device">
      <InfoRow pair label="同步" tone={syncTone(s.state)}>
        <span class="set-sync" data-state={s.state} data-testid="settings-sync">
          <i class="set-sync__dot" aria-hidden="true" />
          {s.message || '—'}
        </span>
      </InfoRow>
      {(s.canRetry || s.canDiscard) && (
        <div class="set-row-actions">
          {s.canRetry && <Button size="sm" variant="tinted" disabled={busy === 'retry'} onClick={retry} data-testid="settings-sync-retry">{busy === 'retry' ? '正在重试…' : '立即重试'}</Button>}
          {s.canDiscard && <Button size="sm" variant="danger-soft" onClick={discard} data-testid="settings-sync-discard">放弃这条改动</Button>}
        </div>
      )}
      <InfoRow pair label="网络">{isOnline ? '在线' : '离线'}</InfoRow>
      <InfoRow pair label="本机存储" tone={store.tone}><span data-testid="settings-storage">{s.storageWarning || store.text}</span></InfoRow>
      {est && Number.isFinite(est.usage) && est.usage > 0 && (
        <InfoRow pair label="本机占用">{`约 ${formatBytes(est.usage)}${Number.isFinite(est.quota) && est.quota > 0 ? `（可用约 ${formatBytes(est.quota)}）` : ''}`}</InfoRow>
      )}
      {persisted !== null && (
        <InfoRow pair label="长期保存">
          <span class="set-persist">
            {persisted ? '已开启' : '没开启'}
            {!persisted && typeof navigator !== 'undefined' && navigator.storage?.persist && (
              <Button size="sm" variant="secondary" disabled={busy === 'persist'} onClick={persist} data-testid="settings-persist">申请开启</Button>
            )}
          </span>
        </InfoRow>
      )}
      <p class="set-hint">没网也能看、能改，联网后自动同步。{persisted === false ? '没开「长期保存」，久不打开可能被系统清掉本机缓存（云端不受影响）。' : ''}</p>
    </Card>
  );
}

function AboutCard() {
  const [checking, setChecking] = useState(false);
  const controlled = swControlled.value;
  const ready = updateReady.value;
  const v = versionParts(appVersion());
  const check = async () => {
    if (!controlled) {
      toast.info('这个页面没有启用离线缓存：刷新就是最新版');
      return;
    }
    setChecking(true);
    try {
      const has = await checkForUpdate();
      if (has) haptic('success');
      else toast.success('已经是最新版本');
    } catch {
      toast.warning('没有检查成功：可能是网络不好，稍后再试');
    } finally {
      setChecking(false);
    }
  };
  const openLicense = (path) => {
    const url = new URL(path, document.baseURI).href;
    openExternal(url, { newTab: true });
  };
  return (
    <Card padding="sm" class="set-card" testId="settings-about">
      <InfoRow pair label="版本">
        <span class="set-version" data-testid="settings-version">{v.version}{v.build && <span class="set-version__build"> · {v.build}</span>}</span>
      </InfoRow>
      <InfoRow pair label="离线可用">{controlled ? '可以' : '还没有'}</InfoRow>
      <div class="set-row-actions">
        {ready ? (
          <Button size="sm" onClick={applyUpdate} leading={<Glyph name="refresh" size={16} />} data-testid="settings-apply-update">有新版本 · 立即更新</Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={checking} onClick={check} leading={checking ? <Spinner size={16} /> : <Glyph name="refresh" size={16} />} data-testid="settings-check-update">
            {checking ? '正在检查…' : '检查更新'}
          </Button>
        )}
      </div>
      <p class="set-hint">{controlled ? '没网也能打开，看到的是上次同步的内容。' : '第一次打开还没有离线缓存：再打开一次（最好加到主屏幕）就有了。'}</p>
      <div class="set-fonts" data-testid="settings-fonts">
        <p class="set-fonts__title">字体授权</p>
        <p class="set-hint">两种字体按 SIL Open Font License 1.1 授权使用。</p>
        <ul class="set-fonts__list">
          {FONT_LICENSES.map((f) => (
            <li key={f.file}>
              <button type="button" class="set-font" data-press="highlight" onClick={() => openLicense(f.file)} data-testid={`settings-font-${f.key}`}>
                <span class="set-font__text">
                  <b>{f.name}</b>
                  <span>{f.use}</span>
                </span>
                <span class="set-font__open" aria-hidden="true"><Glyph name="external" size={16} /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
