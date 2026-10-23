// =====================================================================
// pages/settings/TripPrefs.jsx：设置页每趟行程卡里的「这趟」几项（能编辑的成员才有，批 A · 二、三）。
//
//   日期          1月10日 周日 → 1月13日 周三 · 4 天        [改]   → 改日期面板（TripDates.jsx，sheet trip-dates）
//   这趟怎么走    打车为主 · 公交为主 · 自驾 · 骑车 · 走路为主   （没写过按城市 / 地区默认亮一个；
//                 几个城市默认不一样（台北公交、垦丁骑车）时最前面多一个「按城市」，点了写 move: null，回到每段按城市）
//   叫车用        Grab · Xanh SM · Be                         （这个地区不止一个叫车 App 才出现）
//   只有自己时    「把 Cathy 加进来」（对方的名字从最近一趟只有你们俩的行程里认；认不准写「对方」）
//   创建者        最下面「删掉这一趟」（Members.jsx：先确认，说清楚一起删掉多少安排、账、日记；要联网）
//
// 「这趟怎么走」「叫车用」经 data.rpc.setTripDest 合并写 trips.extra.dest（不整包覆盖 extra）；要联网，
// 点了先亮、失败退回并说原因。拉对方经 data.rpc.addPartner。
// =====================================================================

import { useState } from 'preact/hooks';
import { useTrip, data, online, authState } from '../../data/index.js';
import { openOverlay, toast } from '../../overlay/index.js';
import { Chip } from '../../ui/Chip.jsx';
import { Button } from '../../ui/Button.jsx';
import { Spinner } from '../../ui/Spinner.jsx';
import { Glyph } from '../../kit/Glyph.jsx';
import { haptic } from '../../lib/native.js';
import { profileOf } from '../../rules/dest.js';
import { partnerOf } from '../../sheets/trip-new/moves.js';
import { tripDatesLine, tripMoveModel } from './model.js';
import { DATES_SHEET } from './TripDates.jsx';

const errText = (e, fallback) => (e?.message && /[一-鿿]/.test(e.message) ? e.message : fallback);

/** 对方叫什么：最近出发的另一趟（不是只读的）里另一位能编辑的人（那趟不止你们俩 → null，写「对方」）；只有自己时才读 */
function usePartnerName(entries, tripId, enabled) {
  const other = enabled
    ? entries
      .filter((e) => e.id !== tripId && e.role !== 'viewer')
      .sort((a, b) => String(b.trip?.start_date || '').localeCompare(String(a.trip?.start_date || '')))[0]?.id || null
    : null;
  const store = useTrip(other);
  const me = authState.value.user?.id || null;
  return store?.trip.value ? partnerOf(store.view.members.value, me) : null;
}

/**
 * @param {{ entry: { id, trip }, store: object, entries: Array }} props
 */
export function TripPrefs({ entry, store, entries = [] }) {
  const trip = store.trip.value;
  const members = store.view.members.value;
  const alone = members.filter((m) => ['owner', 'editor'].includes(m.role)).length < 2;
  const partner = usePartnerName(entries, entry.id, alone);
  const [pending, setPending] = useState({});
  const [busy, setBusy] = useState('');
  const isOnline = online.value !== false;
  const profile = profileOf(trip);
  const dest = trip?.extra?.dest || null;
  const hasRegion = Boolean(profile.region);
  const segments = store.tables.segments?.value?.values?.() || [];
  const moves = tripMoveModel(trip, segments, { pending: 'move' in pending ? pending.move : undefined, fallback: profile.far });
  const move = moves.current;
  const rides = profile.ride || [];
  const ride = 'ride' in pending ? pending.ride : rides[0]?.id || null;

  /** 合并写档案；没档案的老行程顺手把地区写上（档案必须有地区） */
  const writeDest = async (key, value) => {
    if (!isOnline) {
      toast.warning('要联网才能改');
      return;
    }
    haptic('selection');
    setPending((p) => ({ ...p, [key]: value }));
    try {
      const patch = { [key]: value };
      if (!dest?.region && profile.region) patch.region = profile.region;
      await data.rpc.setTripDest(entry.id, patch);
      await store.refresh?.();
    } catch (e) {
      toast.error(errText(e, '没改成，再试一次'));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[key];
        return next;
      });
    }
  };

  const addPartner = async () => {
    if (busy) return;
    setBusy('partner');
    try {
      const r = await data.rpc.addPartner(entry.id);
      if (r.added.length) {
        haptic('success');
        toast.success(`${partner || '对方'}加进来了`);
        await store.refresh?.();
      } else {
        toast.warning(r.inHousehold ? '对方已经在这趟里了' : '没找到对方的账号，用「邀请成员」吧');
      }
    } catch (e) {
      toast.error(errText(e, '没加成，再试一次'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div class="set-prefs" data-testid={`settings-prefs-${entry.id}`}>
      <div class="set-pref set-pref--row">
        <span class="set-pref__text">
          <span class="set-pref__label">日期</span>
          <b data-testid={`settings-dates-${entry.id}`}>{tripDatesLine(trip)}</b>
        </span>
        <Button size="sm" variant="secondary" onClick={(e) => openOverlay(DATES_SHEET, { arg: entry.id, trigger: e.currentTarget })} data-testid={`settings-dates-edit-${entry.id}`}>
          改
        </Button>
      </div>
      {hasRegion && (
        <div class="set-pref">
          <span class="set-pref__label" id={`set-move-${entry.id}`}>这趟怎么走</span>
          <div class="set-pref__chips" role="group" aria-labelledby={`set-move-${entry.id}`} data-testid={`settings-move-${entry.id}`}>
            {moves.chips.map((m) => (
              <Chip key={m.id || 'city'} size="sm" selected={move === m.id} onToggle={() => move !== m.id && writeDest('move', m.id)} data-testid={`settings-move-${entry.id}-${m.id || 'city'}`}>
                {m.label}
              </Chip>
            ))}
          </div>
          <p class="set-hint" data-testid={`settings-move-hint-${entry.id}`}>{moves.hint}</p>
        </div>
      )}
      {hasRegion && rides.length > 1 && (
        <div class="set-pref">
          <span class="set-pref__label" id={`set-ride-${entry.id}`}>叫车用</span>
          <div class="set-pref__chips" role="group" aria-labelledby={`set-ride-${entry.id}`} data-testid={`settings-ride-${entry.id}`}>
            {rides.map((r) => (
              <Chip key={r.id} size="sm" selected={ride === r.id} onToggle={() => ride !== r.id && writeDest('ride', r.id)} data-testid={`settings-ride-${entry.id}-${r.id}`}>
                {r.name}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {alone && (
        <Button variant="tinted" block disabled={busy === 'partner' || !isOnline} onClick={addPartner}
          leading={busy === 'partner' ? <Spinner size={18} /> : <Glyph name="user" size={18} />} data-testid={`settings-partner-${entry.id}`}>
          {busy === 'partner' ? '正在加…' : `把 ${partner || '对方'} 加进来`}
        </Button>
      )}
    </div>
  );
}
