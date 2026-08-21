/**
 * F10C2 Phase 3 — Field Results page shell (list ↔ detail).
 * Admin / QC dashboard only. Mock provider — not live server.
 */

import { useEffect, useMemo, useState } from 'react';
import { getFieldResultsRepository } from '../repository/fieldResultsRepository.js';
import { canPerformFieldResultQc } from '../models/fieldResultTypes.js';
import FieldResultsList from './FieldResultsList.jsx';
import FieldResultDetail from './FieldResultDetail.jsx';
import './FieldResults.css';

export default function FieldResultsPage({ user, role }) {
  const repository = useMemo(() => getFieldResultsRepository(), []);
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);

  const effectiveRole = role || user?.role || 'admin';
  const canQc = canPerformFieldResultQc(effectiveRole);

  const actor = useMemo(
    () => ({
      id: user?.id || 'adm-syn-local',
      name: user?.email || 'Admin Reviewer (local)',
      email: user?.email || '',
      role: effectiveRole,
    }),
    [user, effectiveRole],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const res = await repository.getFilterOptions();
      if (!cancelled && res.ok) setFilterOptions(res.options);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository]);

  function openResult(id) {
    setSelectedId(id);
    setView('detail');
  }

  function backToList() {
    setSelectedId(null);
    setView('list');
  }

  return (
    <div className="bdfr-page">
      <div className="bdfr-header">
        <div>
          <p className="bdfr-kicker">QC & Reports · F10C2 Phase 3</p>
          <h2>Field Results</h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            Unified BabyDragon field-test results (mock/local provider). Not live Supabase.
          </p>
        </div>
      </div>

      <div className="bdfr-mock-banner" role="status">
        MOCK / LOCAL DASHBOARD — F10C2_SERVER_SUBMIT remains OFF. No real DB, Storage, or signed
        URLs. Client role checks are UX only; Phase 1 RLS/RPC remain mandatory before production.
      </div>

      {view === 'list' && (
        <FieldResultsList
          repository={repository}
          filterOptions={filterOptions}
          onOpenResult={openResult}
        />
      )}

      {view === 'detail' && selectedId && (
        <FieldResultDetail
          resultId={selectedId}
          repository={repository}
          actor={actor}
          canQc={canQc}
          onBack={backToList}
        />
      )}
    </div>
  );
}
