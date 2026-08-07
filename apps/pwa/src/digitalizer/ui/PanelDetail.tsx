// One panel of the map: the full latest scan, its metadata, and every
// earlier scan as history, newest first. Deleting asks first, and the wording
// promises nothing act one cannot do: gone here is gone.
import { useEffect, useState } from "preact/hooks";

import { panelName } from "../../contracts/geometry";
import { STRINGS } from "../../strings";
import { go, panelHash } from "../../router";
import { getScan, type ScanMeta } from "../db";
import {
  activeMap,
  editNote,
  movePanel,
  presetCoord,
  removeScan,
  versionsOf,
} from "../store";
import { CoordPicker } from "./CoordPicker";

export function PanelDetail({ tx, ty }: { tx: number; ty: number }) {
  const versions = versionsOf(tx, ty);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState("");
  const [armed, setArmed] = useState<string | null>(null);

  const shown =
    (selectedId && versions.find((v) => v.id === selectedId)) || versions[0] || null;

  useEffect(() => {
    let url = "";
    let dead = false;
    if (shown) {
      getScan(shown.id).then((rec) => {
        if (dead || !rec) return;
        url = URL.createObjectURL(rec.image);
        setImgUrl(url);
      });
    } else {
      setImgUrl("");
    }
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shown?.id]);

  const onScanAgain = () => {
    presetCoord.value = { tx, ty };
    go("#/map/scan");
  };

  const onDelete = async (id: string) => {
    setArmed(null);
    const wasShown = shown?.id === id;
    if (await removeScan(id)) {
      if (versionsOf(tx, ty).length === 0) go("#/map");
      else if (wasShown) setSelectedId(null);
    }
  };

  return (
    <div class="card panel-detail" data-testid="panel-detail">
      <div class="panel-head">
        <button class="ghost" data-testid="btn-back-atlas" onClick={() => go("#/map")}>
          ← {STRINGS.navMyMap}
        </button>
        <h2 data-testid="panel-title">
          {panelName(tx, ty)}
          {activeMap.value ? <small> · {activeMap.value.name}</small> : null}
        </h2>
        <button data-testid="btn-scan-again" onClick={onScanAgain}>
          {STRINGS.mmScanAgain}
        </button>
      </div>

      {versions.length > 0 && <MovePanel tx={tx} ty={ty} count={versions.length} />}

      {!versions.length && (
        <p class="note" data-testid="panel-empty">
          {STRINGS.mmNoScansHere}
        </p>
      )}

      {shown && (
        <>
          {imgUrl && <img class="panel-image" data-testid="panel-image" src={imgUrl} />}
          <p class="note" data-testid="panel-meta">
            {new Date(shown.created).toLocaleString()}
            {shown.note ? ` — ${shown.note}` : ""}
            {` · ${shown.width}×${shown.height}`}
          </p>
          <NoteEditor key={shown.id} id={shown.id} note={shown.note} />
          <h3>
            {STRINGS.mmHistoryTitle} <small>({STRINGS.mmNewestFirst})</small>
          </h3>
          <ul class="version-list" data-testid="version-list">
            {versions.map((v, i) => (
              <VersionRow
                key={v.id}
                v={v}
                index={i}
                current={v.id === shown.id}
                armed={armed === v.id}
                onShow={() => setSelectedId(v.id)}
                onArm={() => setArmed(v.id)}
                onDisarm={() => setArmed(null)}
                onDelete={() => onDelete(v.id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// RE-TAG: the whole panel — every version — moves to another coordinate.
// A mis-filed panel deserves better than deletion. An occupied target asks
// whether the histories should become one, ordered by time.
function MovePanel({ tx, ty, count }: { tx: number; ty: number; count: number }) {
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState({ tx, ty });
  const [askMerge, setAskMerge] = useState(false);

  const close = () => {
    setMoving(false);
    setAskMerge(false);
    setTarget({ tx, ty });
  };

  // Moving onto an empty coordinate is the plain move. Moving onto an
  // OCCUPIED one only ever raises the question — the deed needs its own
  // button, which never occupies the slot the question was asked from.
  const onMove = async () => {
    if (target.tx === tx && target.ty === ty) {
      close();
      return;
    }
    if (versionsOf(target.tx, target.ty).length > 0) {
      setAskMerge(true);
      return;
    }
    if (await movePanel({ tx, ty }, target, false)) {
      go(panelHash(target.tx, target.ty));
      close();
    }
  };

  const onMerge = async () => {
    if (await movePanel({ tx, ty }, target, true)) {
      go(panelHash(target.tx, target.ty));
      close();
    }
  };

  if (!moving) {
    return (
      <button class="ghost" data-testid="btn-move-panel" onClick={() => setMoving(true)}>
        {STRINGS.mmMovePanel}
      </button>
    );
  }
  const occupied = versionsOf(target.tx, target.ty).length;
  return (
    <div class="move-panel" data-testid="move-panel">
      <p class="note">{STRINGS.mmMoveHint.replace("{n}", String(count))}</p>
      <CoordPicker
        coord={target}
        onChange={(c) => {
          setTarget(c);
          setAskMerge(false);
        }}
      />
      {askMerge ? (
        <>
          <p class="note merge-note" data-testid="merge-note" role="status">
            {STRINGS.mmMergeConfirm
              .replace("{from}", panelName(tx, ty))
              .replace("{fromN}", String(count))
              .replace("{to}", panelName(target.tx, target.ty))
              .replace("{toN}", String(occupied))}{" "}
            {STRINGS.mmMergeUndoable}
          </p>
          <div class="flow-buttons">
            {/* the deed is deliberate and marked; the safe answer keeps the
                primary slot, so a second tap where the question was asked
                cannot merge anything */}
            <button class="danger" data-testid="btn-merge-confirm" onClick={onMerge}>
              {STRINGS.mmMergeGo}
            </button>
            <button
              class="primary"
              data-testid="btn-merge-decline"
              onClick={() => setAskMerge(false)}
            >
              {STRINGS.mmKeepApart}
            </button>
          </div>
        </>
      ) : (
        <div class="flow-buttons">
          <button class="ghost" data-testid="btn-move-cancel" onClick={close}>
            {STRINGS.cancel}
          </button>
          <button
            class="primary"
            data-testid="btn-move-go"
            disabled={target.tx === tx && target.ty === ty}
            onClick={onMove}
          >
            {STRINGS.mmMoveGo}
          </button>
        </div>
      )}
    </div>
  );
}

// The one after-save edit a scan allows: its note, single-line.
function NoteEditor({ id, note }: { id: string; note: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note);

  if (!editing) {
    return (
      <button class="ghost" data-testid="btn-edit-note" onClick={() => setEditing(true)}>
        {STRINGS.mmEditNote}
      </button>
    );
  }
  const save = async () => {
    if (await editNote(id, value)) setEditing(false);
  };
  return (
    <span class="map-create note-edit">
      <input
        type="text"
        value={value}
        placeholder={STRINGS.mmNote}
        data-testid="input-edit-note"
        onInput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
      />
      <button data-testid="btn-save-note" onClick={save}>
        {STRINGS.mmSaveNote}
      </button>
      <button class="ghost" onClick={() => setEditing(false)}>
        {STRINGS.cancel}
      </button>
    </span>
  );
}

function VersionRow(props: {
  v: ScanMeta;
  index: number;
  current: boolean;
  armed: boolean;
  onShow: () => void;
  onArm: () => void;
  onDisarm: () => void;
  onDelete: () => void;
}) {
  const { v, index, current, armed } = props;
  const [thumbUrl, setThumbUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(v.thumb);
    setThumbUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [v.id]);

  return (
    <li class={current ? "version current" : "version"} data-testid={`version-row-${index}`}>
      <button class="version-pick" onClick={props.onShow}>
        {thumbUrl && <img src={thumbUrl} alt="" />}
      </button>
      <div class="version-meta">
        <span>{new Date(v.created).toLocaleString()}</span>
        {v.note && <small>{v.note}</small>}
      </div>
      {!armed ? (
        <button class="ghost" data-testid={`btn-delete-${index}`} onClick={props.onArm}>
          {STRINGS.mmDelete}
        </button>
      ) : (
        <span class="delete-confirm" data-testid="delete-confirm">
          <small>
            {STRINGS.mmDeleteWarn} {STRINGS.mmDeleteTimelineWarn}
          </small>
          <button class="danger" data-testid="btn-delete-forever" onClick={props.onDelete}>
            {STRINGS.mmReallyDelete}
          </button>
          <button class="ghost" data-testid="btn-delete-cancel" onClick={props.onDisarm}>
            {STRINGS.cancel}
          </button>
        </span>
      )}
    </li>
  );
}
