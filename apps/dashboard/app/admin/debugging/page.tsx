import { RequestTraceExplorer } from '../../../components/request-trace-explorer';

export default function DebuggingPage() {
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#f3f4f6', marginBottom: 4 }}>
        Request Trace Explorer
      </h1>
      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 28 }}>
        Paste a Correlation ID from an X-Correlation-ID response header to view the full trace timeline.
      </p>
      <RequestTraceExplorer />
    </main>
  );
}
