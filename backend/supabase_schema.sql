-- MediSync Production PostgreSQL / Supabase Schema with Row Level Security (RLS)
-- Designed with privacy-by-default and India DPDP Act 2023 data minimization principles.

create extension if not exists "pgcrypto";

-- 1. User profiles (maps 1:1 to auth.users)
create table if not exists public.user_profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text unique not null,
    full_name text not null,
    role text not null check (role in ('patient', 'professional', 'admin')),
    status text not null default 'active' check (status in ('active', 'suspended')),
    created_at timestamptz not null default now()
);

-- 2. Patient profiles
create table if not exists public.patient_profiles (
    user_id uuid primary key references public.user_profiles(id) on delete cascade,
    age int,
    sex text,
    blood_group text,
    height_cm numeric(5,1),
    weight_kg numeric(5,1),
    emergency_note text,
    updated_at timestamptz not null default now()
);

-- 3. MediSync IDs (opaque identifier used in QR codes - zero PII/PHI)
create table if not exists public.medisync_ids (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid unique not null references public.user_profiles(id) on delete cascade,
    medisync_id text unique not null,
    qr_token text unique not null,
    created_at timestamptz not null default now()
);

-- 4. Professional profiles
create table if not exists public.professional_profiles (
    user_id uuid primary key references public.user_profiles(id) on delete cascade,
    specialty text not null,
    registration_number text not null,
    facility_name text,
    verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
    verified_at timestamptz,
    verified_by uuid references public.user_profiles(id)
);

-- 5. Medical documents
create table if not exists public.medical_documents (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    title text not null,
    document_type text not null check (document_type in ('lab_report', 'prescription', 'checkup', 'discharge_summary', 'other')),
    filename text not null,
    storage_path text not null,
    document_date date,
    extraction_status text not null default 'pending' check (extraction_status in ('pending', 'extracted', 'reviewed', 'failed')),
    raw_text text,
    uploaded_at timestamptz not null default now()
);

-- 6. Extracted medical information (supports user review & correction + source traceability)
create table if not exists public.extracted_medical_info (
    id uuid primary key default gen_random_uuid(),
    document_id uuid not null references public.medical_documents(id) on delete cascade,
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    category text not null check (category in ('condition', 'medication', 'allergy', 'lab_result', 'observation', 'event')),
    name text not null,
    value text,
    unit text,
    reference_range text,
    flag text,
    observed_date date,
    source_reference text,
    confidence numeric(3,2) not null default 0.80,
    user_verified boolean not null default false,
    updated_at timestamptz not null default now()
);

-- 7. Device connections (modular connector state)
create table if not exists public.device_connections (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    connector_key text not null,
    display_name text not null,
    integration_mode text not null check (integration_mode in ('csv_import', 'json_import', 'api_unavailable', 'oauth_live')),
    status text not null check (status in ('active_import', 'unavailable', 'connected', 'disconnected')),
    last_sync_at timestamptz,
    records_imported int not null default 0
);

-- 8. Wearable observations
create table if not exists public.wearable_observations (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    source_connector text not null,
    observed_at timestamptz not null,
    resting_hr numeric(5,1),
    avg_hr numeric(5,1),
    spo2 numeric(4,1),
    sleep_hours numeric(4,2),
    deep_sleep_hours numeric(4,2),
    steps int,
    active_minutes int,
    hrv_ms numeric(5,1),
    activity_context text,
    quality_score numeric(3,2) default 0.90,
    is_synthetic boolean not null default false
);

-- 9. Personal baselines
create table if not exists public.personal_baselines (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    metric text not null,
    window_days int not null,
    observation_count int not null,
    baseline_mean numeric(8,2),
    baseline_std numeric(8,2),
    baseline_low numeric(8,2),
    baseline_high numeric(8,2),
    confidence_level text not null check (confidence_level in ('insufficient', 'moderate', 'high')),
    computed_at timestamptz not null default now()
);

-- 10. Health insights & explainable deviations
create table if not exists public.health_insights (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    insight_type text not null,
    title text not null,
    explanation text not null,
    severity text not null check (severity in ('info', 'attention', 'persistent_shift')),
    evidence_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- 11. AI conversations
create table if not exists public.ai_conversations (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    actor_user_id uuid not null references public.user_profiles(id),
    question text not null,
    answer_json jsonb not null,
    created_at timestamptz not null default now()
);

-- 12. Access requests (professional -> patient)
create table if not exists public.access_requests (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    professional_user_id uuid not null references public.user_profiles(id) on delete cascade,
    purpose text not null,
    requested_scopes text[] not null default array['records', 'wearables', 'baseline', 'timeline', 'ai_summary'],
    status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'revoked')),
    created_at timestamptz not null default now(),
    decided_at timestamptz
);

-- 13. Consent records (explicit, revocable, scoped)
create table if not exists public.consent_records (
    id uuid primary key default gen_random_uuid(),
    patient_user_id uuid not null references public.user_profiles(id) on delete cascade,
    professional_user_id uuid not null references public.user_profiles(id) on delete cascade,
    scopes text[] not null,
    status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
    granted_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz
);

-- 14. Audit logs (tamper-evident operational trail)
create table if not exists public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid references public.user_profiles(id),
    actor_role text,
    action text not null,
    target_type text,
    target_id text,
    details_json jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Enable Row Level Security across all sensitive tables
alter table public.user_profiles enable row level security;
alter table public.patient_profiles enable row level security;
alter table public.medisync_ids enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.medical_documents enable row level security;
alter table public.extracted_medical_info enable row level security;
alter table public.device_connections enable row level security;
alter table public.wearable_observations enable row level security;
alter table public.personal_baselines enable row level security;
alter table public.health_insights enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.access_requests enable row level security;
alter table public.consent_records enable row level security;
alter table public.audit_logs enable row level security;

-- Example RLS Policies:
-- Patients own their health records; Professionals can only read when an active consent_record exists;
-- Admins can manage user_profiles & professional_profiles and read audit_logs, NEVER medical_documents/extracted_medical_info.
create policy "patient_own_documents" on public.medical_documents
    for all using (auth.uid() = patient_user_id);

create policy "consented_pro_read_documents" on public.medical_documents
    for select using (
        exists (
            select 1 from public.consent_records cr
            where cr.patient_user_id = medical_documents.patient_user_id
              and cr.professional_user_id = auth.uid()
              and cr.status = 'active'
              and (cr.expires_at is null or cr.expires_at > now())
              and 'records' = any(cr.scopes)
        )
    );

create policy "patient_own_wearables" on public.wearable_observations
    for all using (auth.uid() = patient_user_id);

create policy "consented_pro_read_wearables" on public.wearable_observations
    for select using (
        exists (
            select 1 from public.consent_records cr
            where cr.patient_user_id = wearable_observations.patient_user_id
              and cr.professional_user_id = auth.uid()
              and cr.status = 'active'
              and (cr.expires_at is null or cr.expires_at > now())
              and 'wearables' = any(cr.scopes)
        )
    );
