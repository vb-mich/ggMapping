// The profile: the app's general menu, and the future home of act two's
// account. Today it holds two pages — Playback (the timeline's speed) and
// Maps (create, rename, delete, back up, restore). Every page carries a
// back arrow.
import { useEffect, useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import { beforeProfile, go, type Route } from "../../router";
import type { MapRecord } from "../db";
import {
  PLAYBACK_SPEEDS,
  activeMap,
  backupArchive,
  mapCounts,
  maps,
  newMap,
  notice,
  playbackMs,
  refresh,
  removeMap,
  renameMap,
  restoreArchiveFile,
  setPlaybackMs,
  storeDead,
  switchMap,
} from "../store";

export function ProfileScreen({ route }: { route: Route }) {
  // the profile can be the app's FIRST screen (a reopened tab, a deep
  // link): load the store here too, or the lists and knobs show defaults
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div class="mymap profile">
      {notice.value && (
        <div class="card notice" data-testid="mm-notice" role="status">
          <span>{notice.value}</span>
          <button class="ghost" data-testid="btn-mm-dismiss" onClick={() => (notice.value = null)}>
            {STRINGS.dismiss}
          </button>
        </div>
      )}
      {route.screen === "profile-playback" ? (
        <PlaybackPage />
      ) : route.screen === "profile-maps" ? (
        <MapsPage />
      ) : (
        <ProfileMenu />
      )}
    </div>
  );
}

function PageHead({ title, backTo, testid }: { title: string; backTo: string; testid: string }) {
  return (
    <div class="panel-head">
      <button class="ghost" data-testid={testid} onClick={() => go(backTo)}>
        ← {STRINGS.mmBack}
      </button>
      <h2>{title}</h2>
    </div>
  );
}

function ProfileMenu() {
  return (
    <div class="card" data-testid="profile-menu">
      <PageHead title={STRINGS.pfTitle} backTo={beforeProfile.value} testid="btn-profile-back" />
      <ul class="profile-list">
        <li>
          <button class="profile-entry" data-testid="btn-pf-playback" onClick={() => go("#/profile/playback")}>
            {STRINGS.pfPlayback} <span>›</span>
          </button>
        </li>
        <li>
          <button class="profile-entry" data-testid="btn-pf-maps" onClick={() => go("#/profile/maps")}>
            {STRINGS.pfMaps} <span>›</span>
          </button>
        </li>
      </ul>
    </div>
  );
}

function PlaybackPage() {
  return (
    <div class="card" data-testid="playback-page">
      <PageHead title={STRINGS.pfPlayback} backTo="#/profile" testid="btn-playback-back" />
      <p class="note">{STRINGS.pfPlaybackHint}</p>
      <ul class="profile-list speed-list">
        {PLAYBACK_SPEEDS.map((ms) => (
          <li key={ms}>
            <label class="toggle speed-choice">
              <input
                type="radio"
                name="playback-speed"
                checked={playbackMs.value === ms}
                data-testid={`speed-${ms}`}
                onChange={() => setPlaybackMs(ms)}
              />
              {ms / 1000} s {STRINGS.pfPerUpdate}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapsPage() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const onCreate = async () => {
    await newMap(name.trim());
    setName("");
    setCreating(false);
  };
  return (
    <div class="card" data-testid="maps-page">
      <PageHead title={STRINGS.pfMaps} backTo="#/profile" testid="btn-maps-back" />
      <ul class="profile-list map-list" data-testid="map-list">
        {maps.value.map((m, i) => (
          <MapRow key={m.id} m={m} index={i} />
        ))}
      </ul>
      {!creating ? (
        <button class="ghost" data-testid="btn-pf-new-map" onClick={() => setCreating(true)}>
          {STRINGS.mmNewMap}
        </button>
      ) : (
        <span class="map-create">
          <input
            type="text"
            placeholder={STRINGS.mmMapName}
            value={name}
            data-testid="input-pf-map-name"
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <button data-testid="btn-pf-map-create" onClick={onCreate}>
            {STRINGS.mmCreate}
          </button>
        </span>
      )}
      <h3>{STRINGS.pfBackupTitle}</h3>
      <div class="files-row">
        <button data-testid="btn-backup-current" disabled={storeDead.value}
          onClick={() => backupArchive("current")}>
          {STRINGS.mmBackupCurrent}
        </button>
        <button data-testid="btn-backup-all" disabled={storeDead.value}
          onClick={() => backupArchive("all")}>
          {STRINGS.mmBackupAll}
        </button>
        <label class="file-button">
          {STRINGS.mmRestore}
          <input
            type="file"
            accept=".zip,application/zip"
            data-testid="input-restore"
            onChange={async (e) => {
              const input = e.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              input.value = "";
              if (file) await restoreArchiveFile(file);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function MapRow({ m, index }: { m: MapRecord; index: number }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.name);
  const [armed, setArmed] = useState(false);
  const count = mapCounts.value.get(m.id) ?? 0;
  const isCurrent = activeMap.value?.id === m.id;

  const onRename = async () => {
    if (name.trim() && (await renameMap(m.id, name))) setEditing(false);
  };
  const onOpen = async () => {
    await switchMap(m.id);
    go("#/map");
  };

  return (
    <li class="map-row" data-testid={`map-row-${index}`}>
      {!editing ? (
        <span class="map-row-name">
          <b>{m.name}</b>
          {isCurrent && <span class="chip now-chip">{STRINGS.pfCurrent}</span>}
          <small>
            {count} {count === 1 ? STRINGS.mmScanWord : STRINGS.mmScansWord}
          </small>
        </span>
      ) : (
        <span class="map-create">
          <input
            type="text"
            value={name}
            data-testid={`input-rename-${index}`}
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <button data-testid={`btn-rename-save-${index}`} onClick={onRename}>
            {STRINGS.mmCreate}
          </button>
          <button class="ghost" onClick={() => setEditing(false)}>
            {STRINGS.cancel}
          </button>
        </span>
      )}
      {!editing && !armed && (
        <span class="map-row-actions">
          {!isCurrent && (
            <button class="ghost" data-testid={`btn-open-map-${index}`} onClick={onOpen}>
              {STRINGS.pfOpen}
            </button>
          )}
          <button class="ghost" data-testid={`btn-rename-map-${index}`} onClick={() => setEditing(true)}>
            {STRINGS.pfRename}
          </button>
          <button class="ghost" data-testid={`btn-delete-map-${index}`} onClick={() => setArmed(true)}>
            {STRINGS.mmDelete}
          </button>
        </span>
      )}
      {armed && (
        <span class="delete-confirm" data-testid="map-delete-confirm">
          <small>
            {STRINGS.pfDeleteMapWarn.replace("{name}", m.name).replace("{n}", String(count))}
          </small>
          <button
            class="danger"
            data-testid={`btn-delete-map-forever-${index}`}
            onClick={() => removeMap(m.id)}
          >
            {STRINGS.mmReallyDelete}
          </button>
          <button class="ghost" data-testid={`btn-delete-map-cancel-${index}`} onClick={() => setArmed(false)}>
            {STRINGS.cancel}
          </button>
        </span>
      )}
    </li>
  );
}
