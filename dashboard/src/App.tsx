import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import {
  ApiClient,
  ConnectionContext,
  clearConnection,
  loadConnection,
  saveConnection,
  type Connection,
} from './api.ts';
import { ConnectGate } from './components/ConnectGate.tsx';
import { Layout } from './components/Layout.tsx';
import { Overview } from './pages/Overview.tsx';
import { Insights } from './pages/Insights.tsx';
import { Customers } from './pages/Customers.tsx';
import { Products } from './pages/Products.tsx';
import { Entitlements } from './pages/Entitlements.tsx';
import { Offerings } from './pages/Offerings.tsx';
import { Experiments } from './pages/Experiments.tsx';
import { Webhooks } from './pages/Webhooks.tsx';
import { Billing } from './pages/Billing.tsx';
import { Audit } from './pages/Audit.tsx';
import { Settings } from './pages/Settings.tsx';

export default function App() {
  const [conn, setConn] = useState<Connection | null>(loadConnection());

  const value = useMemo(() => {
    if (!conn) return null;
    return {
      conn,
      api: new ApiClient(conn),
      disconnect: () => {
        clearConnection();
        setConn(null);
      },
    };
  }, [conn]);

  if (!value) {
    return (
      <ConnectGate
        onConnect={(c) => {
          saveConnection(c);
          setConn(c);
        }}
      />
    );
  }

  return (
    <ConnectionContext.Provider value={value}>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/products" element={<Products />} />
          <Route path="/entitlements" element={<Entitlements />} />
          <Route path="/offerings" element={<Offerings />} />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="/webhooks" element={<Webhooks />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ConnectionContext.Provider>
  );
}
