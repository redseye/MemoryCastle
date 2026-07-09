import { useState } from 'react';
import { addRoomRecord, createRoom, deleteRoom, getCastleOverview, getRoom, getRooms, patchRoom } from '../api';
import { ConfidenceBadge, DateBadge, SourceBadge, TagChip } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { useProjects } from '../ProjectContext';
import { navigate } from '../router';
import type { Confidence, RoomFile } from '../types';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function CreateRoomForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [locus, setLocus] = useState('');
  const [adjacent, setAdjacent] = useState('');
  const [emblem, setEmblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createRoom(projectId, {
        name: name.trim(),
        locus: splitList(locus),
        adjacent: splitList(adjacent),
        emblem: emblem.trim() || null,
      });
      setName('');
      setLocus('');
      setAdjacent('');
      setEmblem('');
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>新增房間</h3>
      <ErrorBanner error={error} />
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          名稱
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Locus（逗號分隔的路徑／主題）
          <input type="text" value={locus} onChange={(e) => setLocus(e.target.value)} />
        </label>
        <label>
          Adjacent（逗號分隔的房間 slug）
          <input type="text" value={adjacent} onChange={(e) => setAdjacent(e.target.value)} />
        </label>
        <label>
          Emblem（選填）
          <input type="text" value={emblem} onChange={(e) => setEmblem(e.target.value)} />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            建立房間
          </button>
        </div>
      </form>
    </div>
  );
}

function RoomList({ projectId }: { projectId: string }) {
  const { data, loading, error, reload } = useAsync(() => getRooms(projectId), [projectId]);
  const overview = useAsync(() => getCastleOverview(projectId), [projectId]);
  const roomMax = overview.data?.budgets.roomMax ?? 120;

  return (
    <div>
      <ErrorBanner error={error} />
      {loading ? (
        <Loading />
      ) : !data || data.rooms.length === 0 ? (
        <EmptyState title="尚無房間" hint="使用下方表單新增第一間房間。" />
      ) : (
        <div className="card-grid">
          {data.rooms.map((room) => (
            <button key={room.slug} type="button" className="card" onClick={() => navigate(`/rooms/${room.slug}`)}>
              <div className="card-title">
                {room.name} {room.emblem && <span title="emblem">{room.emblem}</span>}
              </div>
              <div className="card-meta">locus：{room.locus.length > 0 ? room.locus.join('、') : '（無）'}</div>
              <div className="card-meta">adjacent：{room.adjacent.length > 0 ? room.adjacent.join('、') : '（無）'}</div>
              <div className="gauge" style={{ marginTop: '0.5rem' }}>
                <div className="gauge-label">
                  <span>記錄數</span>
                  <span>
                    {room.records.length}/{roomMax}
                  </span>
                </div>
                <div className="gauge-track">
                  <div
                    className={room.records.length > roomMax ? 'gauge-fill over' : 'gauge-fill'}
                    style={{ width: `${Math.min((room.records.length / roomMax) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <CreateRoomForm projectId={projectId} onCreated={reload} />
    </div>
  );
}

function AddRoomRecordForm({ projectId, slug, onAdded }: { projectId: string; slug: string; onAdded: () => void }) {
  const [fact, setFact] = useState('');
  const [confidence, setConfidence] = useState<Confidence>('high');
  const [source, setSource] = useState('user');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fact.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addRoomRecord(projectId, slug, {
        fact: fact.trim(),
        confidence,
        source: source.trim() || 'user',
        tags: splitList(tags),
      });
      setFact('');
      setTags('');
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ErrorBanner error={error} />
      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          事實
          <textarea value={fact} onChange={(e) => setFact(e.target.value)} required />
        </label>
        <label>
          信心
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
            <option value="high">high</option>
            <option value="med">med</option>
            <option value="low">low</option>
          </select>
        </label>
        <label>
          來源
          <input type="text" value={source} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label>
          標籤（逗號分隔）
          <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            新增記錄
          </button>
        </div>
      </form>
    </div>
  );
}

function LocusEditor({ projectId, room, onSaved }: { projectId: string; room: RoomFile; onSaved: () => void }) {
  const [locus, setLocus] = useState(room.locus.join(', '));
  const [adjacent, setAdjacent] = useState(room.adjacent.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      await patchRoom(projectId, room.slug, { locus: splitList(locus), adjacent: splitList(adjacent) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-grid">
      <ErrorBanner error={error} />
      <label>
        Locus（逗號分隔）
        <input type="text" value={locus} onChange={(e) => setLocus(e.target.value)} />
      </label>
      <label>
        Adjacent（逗號分隔）
        <input type="text" value={adjacent} onChange={(e) => setAdjacent(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSave}>
          儲存修改
        </button>
      </div>
    </div>
  );
}

function RoomDetail({ projectId, slug }: { projectId: string; slug: string }) {
  const { data, loading, error, reload } = useAsync(() => getRoom(projectId, slug), [projectId, slug]);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteRoom(projectId, slug);
      navigate('/rooms');
    } catch (e) {
      setDeleteError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (!data) return null;

  return (
    <div>
      <button type="button" className="btn" onClick={() => navigate('/rooms')}>
        ← 返回房間列表
      </button>
      <h2>
        {data.name} {data.emblem}
      </h2>
      <div className="panel">
        <p>
          <strong>Locus：</strong>
          {data.locus.length > 0 ? data.locus.join('、') : '（無）'}
        </p>
        <p>
          <strong>Adjacent：</strong>
          {data.adjacent.length > 0 ? (
            data.adjacent.map((slugName) => (
              <button
                key={slugName}
                type="button"
                className="chip"
                style={{ border: 'none', cursor: 'pointer' }}
                onClick={() => navigate(`/rooms/${slugName}`)}
              >
                {slugName}
              </button>
            ))
          ) : (
            '（無）'
          )}
        </p>
        <p className="card-meta">建立於：{data.createdAt}</p>
        <h3>編輯 Locus / Adjacent</h3>
        <LocusEditor projectId={projectId} room={data} onSaved={reload} />
      </div>

      <div className="panel">
        <h3>記錄（{data.records.length}）</h3>
        {data.records.length === 0 ? (
          <EmptyState title="此房間尚無記錄" />
        ) : (
          <ul className="record-list">
            {data.records.map((r) => (
              <li key={r.id} className="record-row">
                <div className="record-main">
                  <p className="record-fact">{r.fact}</p>
                  <div className="record-badges">
                    <DateBadge date={r.date} />
                    <ConfidenceBadge confidence={r.confidence} />
                    <SourceBadge source={r.source} />
                    {r.tags.map((t) => (
                      <TagChip key={t} tag={t} />
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <h3 style={{ marginTop: '0.9rem' }}>新增記錄</h3>
        <AddRoomRecordForm projectId={projectId} slug={slug} onAdded={reload} />
      </div>

      <div className="panel">
        <ErrorBanner error={deleteError} />
        <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => setPendingDelete(true)}>
          刪除此房間
        </button>
      </div>
      <ConfirmDialog
        open={pendingDelete}
        title="確認刪除房間"
        message={`即將刪除房間「${data.name}」與其所有記錄，此操作無法復原。`}
        danger
        confirmLabel="刪除"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}

export function RoomsPage({ slug }: { slug?: string }) {
  const { currentProjectId } = useProjects();

  if (!currentProjectId) {
    return (
      <div>
        <h1>房間瀏覽</h1>
        <EmptyState title="尚未選擇專案" hint="請先到「總覽」頁面選擇或註冊一個專案。" />
      </div>
    );
  }

  return (
    <div>
      <h1>房間瀏覽</h1>
      {slug ? <RoomDetail projectId={currentProjectId} slug={slug} /> : <RoomList projectId={currentProjectId} />}
    </div>
  );
}
