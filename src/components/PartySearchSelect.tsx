"use client";

import { useId, useState } from 'react';
import { matchesSearch, partyLabel } from '@/lib/search';

type Party = { id: string | number; name?: string | null; business_name: string; rfc?: string | null };
export default function PartySearchSelect({ parties, value, onChange, disabled }: {
    parties: Party[]; value: string; onChange: (id: string) => void; disabled?: boolean;
}) {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const id = useId();
    const selected = parties.find(p => String(p.id) === String(value));
    const matches = parties.filter(p => matchesSearch(search, p.name, p.business_name, p.rfc));
    return <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
        <input aria-label="Buscar cliente por alias, razón social o RFC" aria-expanded={open} aria-controls={id}
            role="combobox" autoComplete="off" disabled={disabled}
            value={open ? search : partyLabel(selected)}
            onFocus={() => { setSearch(''); setOpen(true); }}
            onChange={e => { setSearch(e.target.value); setOpen(true); }}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && open) { e.preventDefault(); if (matches.length === 1) { onChange(String(matches[0].id)); setOpen(false); } } }}
            placeholder="Escribe nombre, alias o RFC…"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-white" />
        {open && <div id={id} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl">
            {matches.length === 0 && <p className="p-3 text-neutral-400">Sin coincidencias</p>}
            {matches.map(p => <button type="button" role="option" aria-selected={String(p.id) === String(value)} key={p.id}
                onClick={() => { onChange(String(p.id)); setOpen(false); }}
                className="block w-full px-4 py-3 text-left text-white hover:bg-neutral-800 focus:bg-neutral-800">
                {partyLabel(p)} <span className="text-xs text-neutral-400">{p.rfc}</span>
            </button>)}
        </div>}
    </div>;
}
