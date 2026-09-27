import { useState } from "react";
import { downloadBackup } from "../io/files";
import { relTime } from "../lib/keys";
import { disableSync, enableSync, listBackups, loadBackup, syncNow, useSync, type Backup } from "../sync/engine";
import { useStore } from "../store/store";

const LABEL = { off: "Off", syncing: "Syncing…", synced: "Synced", offline: "Offline — will retry", error: "Error" } as const;

export function SyncSection() {
  const { status, code, lastSync, error } = useSync();
  const [join, setJoin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = (t: string) => useStore.getState().toast(t);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="d-sec">
      <div className="label">Sync across devices</div>
      {status === "off" ? (
        <>
          <small className="dim">
            Keep your grove in step on your phone and computer. It's end-to-end encrypted with a sync code that only your devices know. The
            server stores unreadable data, and nobody can recover it without the code.
          </small>
          <div className="sync-row">
            <button className="btn solid" disabled={busy} onClick={() => run(() => enableSync().then(() => setShow(true)))}>
              ☁ Turn on sync
            </button>
            <span className="dim mono" style={{ fontSize: 11 }}>
              or join with a code from another device:
            </span>
          </div>
          <div className="sync-row">
            <input
              className="input mono"
              placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
              value={join}
              onChange={(e) => setJoin(e.target.value)}
              aria-label="Sync code"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="btn"
              disabled={busy || !join.trim()}
              onClick={() =>
                run(async () => {
                  await enableSync(join.trim());
                  setJoin("");
                  toast("Joined — your groves are merging");
                })
              }
            >
              Join
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sync-row">
            <span className={`sync-dot s-${status}`} />
            <span>
              {LABEL[status]}
              {status === "synced" && lastSync ? <span className="dim"> · {relTime(lastSync)} ago</span> : null}
            </span>
            {error && (
              <span className="dim mono" style={{ fontSize: 11 }}>
                {error}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn small" disabled={status === "syncing"} onClick={() => void syncNow()}>
              Sync now
            </button>
          </div>
          <div className="sync-row">
            <code className="sync-code">{show ? code : "••••-••••-••••-••••-••••-••••-••••"}</code>
            <button className="btn ghost small" onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show code"}
            </button>
            <button
              className="btn ghost small"
              onClick={() =>
                code &&
                navigator.clipboard?.writeText(code).then(
                  () => toast("Sync code copied"),
                  () => setShow(true),
                )
              }
            >
              Copy
            </button>
          </div>
          <small className="dim">
            To add another device, open Mindgrove on it, go to Settings → Sync, and enter this code. Keep the code private: anyone who has
            it can read and change your grove.
          </small>
          <BackupHistory />
          <div>
            <button
              className="btn danger small"
              onClick={() =>
                confirm("Stop syncing on this device? Your thoughts stay here and on your other devices.") && void disableSync()
              }
            >
              Turn off on this device
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Small HUD indicator; hidden when sync is off. */
export function SyncChip() {
  const status = useSync((s) => s.status);
  if (status === "off") return null;
  return (
    <button
      className={`icon-btn sync-chip s-${status}`}
      onClick={() => useStore.getState().openSettings(true)}
      title={`Sync: ${LABEL[status]}`}
      aria-label={`Sync ${LABEL[status]}`}
    >
      {status === "syncing" ? "⟳" : "☁"}
    </button>
  );
}

const when = (at: number) =>
  new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Encrypted snapshots the server keeps (every ~6 h, 30 days): bring back what's missing, or download one. */
function BackupHistory() {
  const [items, setItems] = useState<Backup[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const toast = (t: string) => useStore.getState().toast(t);

  const open = async () => {
    try {
      setItems(await listBackups());
    } catch (e) {
      toast(`Couldn't load backups: ${(e as Error).message}`);
    }
  };
  const act = async (at: number, what: "restore" | "download") => {
    setBusy(at);
    try {
      const doc = await loadBackup(at);
      const st = useStore.getState();
      if (what === "download") {
        downloadBackup({ thoughts: doc.thoughts, limbs: doc.limbs, links: doc.links }, st.settings);
        return;
      }
      const missing = doc.thoughts.filter((t) => !st.thoughts[t.id]).length;
      if (!missing) return toast("Nothing missing: everything in that backup is still in your grove");
      if (!confirm(`Bring back ${missing} thought${missing > 1 ? "s" : ""} from ${when(at)}? Nothing you have now is changed.`)) return;
      const n = st.restoreMissing(doc);
      toast(`Brought back ${n} thought${n > 1 ? "s" : ""}`);
    } catch (e) {
      toast(`Backup failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  if (!items)
    return (
      <div className="sync-row">
        <button className="btn ghost small" onClick={() => void open()}>
          ⟲ Backup history
        </button>
        <small className="dim">The server keeps an encrypted copy every ~6 hours for 30 days.</small>
      </div>
    );
  return (
    <div className="backups">
      <div className="label">Backup history</div>
      {items.length === 0 ? (
        <small className="dim">No backups yet: the first one is saved on the next sync.</small>
      ) : (
        <ul>
          {items.map((b) => (
            <li key={b.at}>
              <span className="mono">{when(b.at)}</span>
              <span className="dim mono">{relTime(b.at)} ago</span>
              <span style={{ flex: 1 }} />
              <button
                className="btn small"
                disabled={busy !== null}
                onClick={() => void act(b.at, "restore")}
                title="Adds back anything deleted since; changes nothing else"
              >
                Bring back missing
              </button>
              <button
                className="btn ghost small"
                disabled={busy !== null}
                onClick={() => void act(b.at, "download")}
                title="Save it as a JSON backup"
              >
                ⤓
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="dim">
        “Bring back missing” only adds thoughts you've deleted since then. To roll everything back, download it and use Restore backup.
      </small>
    </div>
  );
}
