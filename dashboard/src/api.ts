import { createContext, useContext } from 'react';

export interface Connection {
  baseUrl: string;
  secretKey: string;
}

const STORAGE_KEY = 'revenuedog.connection';

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Connection) : null;
  } catch {
    return null;
  }
}

export function saveConnection(conn: Connection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
}

export function clearConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class ApiClient {
  constructor(private conn: Connection) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.conn.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.conn.secretKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'network_error', `Could not reach ${this.conn.baseUrl}. Is the backend running?`);
    }
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (json as { error?: { code: string; message: string } }).error;
      throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
    }
    return json as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }
}

export const ConnectionContext = createContext<{ conn: Connection; api: ApiClient; disconnect: () => void } | null>(
  null,
);

export function useApi() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useApi must be used within a connected context');
  return ctx;
}

// ---- API response types (mirror docs/API.md) ----

export interface Point {
  date: string;
  value: number;
}

export interface Overview {
  generated_at: string;
  range_days: number;
  kpis: {
    active_subscriptions: number;
    active_trials: number;
    mrr: number;
    revenue: number;
    new_customers: number;
    active_subscribers: number;
    total_subscribers: number;
  };
  charts: {
    revenue: Point[];
    new_customers: Point[];
    subscriptions_started: Point[];
    active_subscriptions: Point[];
  };
  revenue_by_product: { product: string; revenue: number }[];
  subscription_status: { status: string; count: number }[];
  recent_transactions: {
    id: string;
    app_user_id: string;
    product: string;
    store: string;
    price: number | null;
    currency: string | null;
    date: string;
  }[];
}

export interface Product {
  id: string;
  store_identifier: string;
  type: 'subscription' | 'non_consumable' | 'consumable';
  store: 'app_store' | 'play_store';
  display_name: string;
  duration: string | null;
}

export interface Entitlement {
  id: string;
  identifier: string;
  display_name: string;
  product_ids: string[];
}

export interface OfferingPackage {
  identifier: string;
  product_ids: string[];
}

export interface Offering {
  id: string;
  identifier: string;
  description: string;
  metadata: Record<string, unknown>;
  is_current: boolean;
  packages: OfferingPackage[];
}

export interface Experiment {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'stopped';
  control_offering_id: string;
  treatment_offering_id: string;
  traffic_pct: number;
  created_at: string;
}

export interface ExperimentResults {
  control: { enrolled: number; purchases: number; revenue: number };
  treatment: { enrolled: number; purchases: number; revenue: number };
}

export interface SubscriberSummary {
  id: string;
  original_app_user_id: string;
  first_seen: string;
  last_seen: string;
  active_entitlements: string[];
  active_subscriptions: string[];
}

export interface AppRow {
  id: string;
  name: string;
  public_api_key: string;
  bundle_id: string | null;
  package_name: string | null;
  created_at: string;
}

export interface Diagnostics {
  backend_version: string;
  generated_at: string;
  validation: { app_store: string; play_store: string };
  totals: { apps: number; products: number; entitlements: number; offerings: number; subscribers: number; events: number };
  apps: {
    id: string;
    name: string;
    connected: boolean;
    last_seen: string | null;
    platforms: { platform: string; sdk_version: string | null; app_version: string | null; last_seen: string; request_count: number }[];
  }[];
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[] | '*';
  active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status_code: number | null;
  ok: number;
  error: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  type: string;
  app_user_id: string | null;
  product_store_identifier: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
  created_at: string;
}

export interface Insights {
  generated_at: string;
  funnel: { stage: string; count: number }[];
  trial_conversion: { trials: number; converted: number; rate: number };
  ltv: { total_customers: number; paying_customers: number; total_revenue: number; arpu: number; arppu: number };
  cohorts: {
    cohort: string;
    customers: number;
    paying: number;
    revenue: number;
    revenue_per_customer: number;
    active_now: number;
    retention_pct: number;
  }[];
}

export const EVENT_TYPES = [
  'initial_purchase',
  'renewal',
  'trial_started',
  'non_renewing_purchase',
  'promotional_grant',
  'expiration',
  'billing_issue',
  'cancellation',
];
