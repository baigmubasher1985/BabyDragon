/**
 * F10C2 Phase 3 — Field Results page shell (list ↔ detail).
 * Admin / QC dashboard only.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { isFieldResultsSupabaseProviderEnabled } from '../../lib/f10c2FeatureFlags.js';
import { getFieldResultsRepository } from '../repository/fieldResultsRepository.js';
import { resolveFieldResultsDashboardRole } from '../models/fieldResultTypes.js';
import FieldResultsList from './FieldResultsList.jsx';
import FieldResultDetail from './FieldResultDetail.jsx';
import './FieldResults.css';

export default function FieldResultsPage({ user, role, onOpenQcReview, forceMock = false }) {
  const repository = useMemo(() => {
    if (forceMock) {
      return getFieldResultsRepository({ kind: 'mock', forceNew: true });
    }
    if (isFieldResultsSupabaseProviderEnabled()) {
      return getFieldResultsRepository({ kind: 'supabase', supabase, forceNew: true });
    }
    return getFieldResultsRepository();
  }, [forceMock]);
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);
  const [filterOptions, setFilterOptions] = useState(null);

  const effectiveRole = resolveFieldResultsDashboardRole(role, user);

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

  const showDisposableBadge = repository.kind !== 'production';

  return (
    <div className="bdfr-page">
      <div className="bdfr-header">
        <div>
          <p className="bdfr-kicker">Field Operations</p>
          <h2>Field Results</h2>
          <p style={{ margin: 0, color: 'var(--bdfr-muted)', fontSize: 13 }}>
            Review completed field tests, measured results, GPS routes and reports.
          </p>
          {showDisposableBadge && (
            <span className="bdfr-disposable-badge">Disposable Validation</span>
          )}
        </div>
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
          onBack={backToList}
          onOpenQcReview={onOpenQcReview}
        />
      )}
    </div>
  );
}
