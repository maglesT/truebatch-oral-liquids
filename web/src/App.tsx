import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, can, type Me } from './api.js';
import { Login } from './pages/Login.js';
import { MyWork } from './floor/MyWork.js';
import { BatchScreen } from './floor/BatchScreen.js';
import { go, useRoute } from './api-floor.js';
import { Masters } from './designer/Masters.js';
import { ToReview } from './release/ToReview.js';
import { ReleaseScreen } from './release/ReleaseScreen.js';
import { product } from './product.js';

type Page = 'home' | 'masters';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [page, setPage] = useState<Page>('home');
  // A demo installation says so on every screen, the sign-in screen too (GET /api/health needs no session).
  const [demo, setDemo] = useState(false);
  useEffect(() => { void api<{ demo?: boolean }>('GET', '/api/health', undefined, true).then((h) => setDemo(!!h.demo), () => {}); }, []);
  const banner = demo && <div className="demo-banner" role="note">DEMO · a demonstration installation, not for GMP use · waits can be skipped</div>;
  // Floor screens: #/batch/12, #/batch/12/step/0.1.0.1, #/batch/12/approve (the tablet's back button works); the QC
  // and QA screens: #/release, #/release/12.
  const route = useRoute();
  const release = route.release;

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('GET', '/api/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Real use of the screen (a tap, a key, e.g. typing 20 tablet weights before saving them) keeps the session alive as a
  // saved entry does, at most one call a minute; the 15-minute idle rule stays for an unattended screen (polls never
  // count), and the session still ends when core's sign-on does (8 hours). An idle-ended session shows Sign in at once.
  useEffect(() => {
    let last = Date.now();
    const used = () => { if (Date.now() - last > 60_000) { last = Date.now(); void refresh(); } };
    window.addEventListener('pointerdown', used);
    window.addEventListener('keydown', used);
    return () => { window.removeEventListener('pointerdown', used); window.removeEventListener('keydown', used); };
  }, [refresh]);
  // A batch opened from another page (a batch just issued from the master records) shows on the floor screens.
  useEffect(() => { if (route.batch) setPage('home'); }, [route.batch]);

  if (me === undefined) return <>{banner}<main className="page">Loading…</main></>;
  if (me === null) return <>{banner}<Login /></>;

  // Ends the core session too (shared terminals, one person per browser): the browser goes to core's sign-out page.
  const logout = async () => {
    const r = await api<{ logoutUrl: string | null }>('POST', '/api/logout');
    setMe(null);
    if (r.logoutUrl) window.location.assign(r.logoutUrl);
  };

  return (
    <>
      {banner}
      <header className="bar">
        <span className="brand"><img className="brand-mark" src="/truebatch-mark.svg" alt="TrueBatch" /><span><b>{product.name}</b><small>by Medhanta</small></span></span>
        <nav>
          <button className={page === 'home' && !route.batch && !release ? 'tab on' : 'tab'} onClick={() => { setPage('home'); go('#/'); }}>My work</button>
          {['qc.approve', 'qa.release'].some((c) => can(me, c)) && (
            <button className={release ? 'tab on' : 'tab'} onClick={() => { setPage('home'); go('#/release'); }}>To review</button>
          )}
          {['master.author', 'master.check', 'master.approve', 'batch.issue', 'view'].some((c) => can(me, c)) && (
            <button className={page === 'masters' && !release ? 'tab on' : 'tab'} onClick={() => { setPage('masters'); go('#/'); }}>{product.masters}</button>
          )}
        </nav>
        <span className="who">
          {me.fullName}
          <button className="link" onClick={logout}>Log out</button>
        </span>
      </header>
      <main className="page">
        {release ? (release === 'list' ? <ToReview me={me} /> : <ReleaseScreen me={me} id={release} />) : (<>
          {page === 'home' && (route.batch ? <BatchScreen me={me} id={route.batch} step={route.step} approve={route.approve} /> : <MyWork me={me} />)}
          {page === 'masters' && <Masters me={me} />}
        </>)}
      </main>
    </>
  );
}
