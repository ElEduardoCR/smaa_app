-- Comisionados (comisionados / special sales agents) per quotation.
-- A quotation (normal OR "cotización rápida") can carry 1+ commissioners.
-- We only track the agent name and the amount that corresponds to them
-- ("lo que le toca"); the user computes that amount manually.
--
-- This is INTERNAL reference only: it flags that a quotation is commissioned and
-- records how much each commissioner earns. It is NOT rendered on the
-- client-facing quotation PDF.
--
-- Stored as JSONB array: [{ "name": "Juan Pérez", "amount": 1500 }, ...].
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS commissioners JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Lightweight catalog of commissioner names so they can be reused across
-- quotations (fed into a datalist in the UI). Names accumulate automatically as
-- quotations are saved, so no manual maintenance screen is required.
CREATE TABLE IF NOT EXISTS public.commission_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.commission_agents ENABLE ROW LEVEL SECURITY;

-- Permissive development policy, consistent with the rest of the schema.
DROP POLICY IF EXISTS "Allow all operations for commission_agents" ON public.commission_agents;
CREATE POLICY "Allow all operations for commission_agents" ON public.commission_agents
    FOR ALL USING (true) WITH CHECK (true);
