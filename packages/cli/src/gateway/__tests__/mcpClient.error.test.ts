import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { McpHttpClient } from '../mcpClient.js';
import { LiveGateway } from '../LiveGateway.js';
import { CliError, ExitCode } from '../../cli/exitCodes.js';

/**
 * Centralized tool-error handling: `callTool` throws on an error result unless
 * the caller opts out, so no gateway method can silently mask a rejected write.
 * Previously `createTracker` fabricated a "(created)" record and
 * `updateTracker` re-fetched the unchanged item, reporting both as success.
 */

type QueuedResponse = { body: string; headers?: Record<string, string> };
const queue: QueuedResponse[] = [];

const jsonHeaders = { 'content-type': 'application/json' };

function queueInitHandshake() {
  queue.push({ body: '{"jsonrpc":"2.0","id":1,"result":{}}', headers: { ...jsonHeaders, 'mcp-session-id': 's1' } });
  queue.push({ body: '{}' , headers: jsonHeaders }); // notifications/initialized
}

function queueToolResult(payload: { structured?: any; summary?: string }, isError: boolean) {
  queue.push({
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        isError,
      },
    }),
    headers: jsonHeaders,
  });
}

beforeEach(() => {
  queue.length = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch queue exhausted');
    return new Response(next.body, { status: 200, headers: next.headers ?? jsonHeaders });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const client = () => new McpHttpClient({ port: 3456, token: 't' });
const gateway = () => new LiveGateway({ pid: 1, port: 3456, token: 't', startedAt: '' } as any);

describe('McpHttpClient.callTool centralized error handling', () => {
  it('throws CONNECTION by default when the tool returns an error result', async () => {
    queueInitHandshake();
    queueToolResult({ summary: 'something broke' }, true);
    const err = await client().callTool('/ws', 'tracker_list', {}).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe(ExitCode.CONNECTION);
    expect(err.message).toMatch(/something broke/);
  });

  it('throws the caller-provided errorCode', async () => {
    queueInitHandshake();
    queueToolResult({ summary: "tracker_create rejected by tracker schema 'plan'" }, true);
    const err = await client()
      .callTool('/ws', 'tracker_create', {}, { errorCode: ExitCode.WRITE_NOT_PERMITTED })
      .catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe(ExitCode.WRITE_NOT_PERMITTED);
    expect(err.message).toMatch(/rejected by tracker schema/);
  });

  it('returns the error result when tolerateError is set', async () => {
    queueInitHandshake();
    queueToolResult({ summary: 'Tracker item not found: NIM-999' }, true);
    const result = await client().callTool('/ws', 'tracker_get', { id: 'NIM-999' }, { tolerateError: true });
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/not found/);
  });
});

describe('LiveGateway over centralized errors', () => {
  it('createTracker rejects with WRITE_NOT_PERMITTED instead of fabricating "(created)"', async () => {
    queueInitHandshake();
    queueToolResult({ summary: "tracker_create rejected by tracker schema 'plan':\n- planId: Field 'planId' is required" }, true);
    const err = await gateway().createTracker('/ws', { type: 'plan', title: 'A plan' } as any).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe(ExitCode.WRITE_NOT_PERMITTED);
    expect(err.message).toMatch(/planId/);
  });

  it('updateTracker rejects instead of reporting the unchanged item as updated', async () => {
    queueInitHandshake();
    queueToolResult({ summary: "tracker_update rejected by tracker schema 'task':\n- status: invalid option: bogus" }, true);
    const err = await gateway().updateTracker('/ws', 'NIM-1', { status: 'bogus' } as any).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.code).toBe(ExitCode.WRITE_NOT_PERMITTED);
    expect(err.message).toMatch(/invalid option/);
  });

  it('createTracker succeeds normally on a non-error result', async () => {
    queueInitHandshake();
    queueToolResult({ structured: { action: 'created', item: { id: 'task_1', type: 'task', title: 'T' } } }, false);
    const record = await gateway().createTracker('/ws', { type: 'task', title: 'T' } as any);
    expect(record.id).toBe('task_1');
  });

  it('getTracker still returns null for a not-found error result', async () => {
    queueInitHandshake();
    queueToolResult({ summary: 'Tracker item not found: NIM-999' }, true);
    const record = await gateway().getTracker('/ws', 'NIM-999');
    expect(record).toBeNull();
  });
});
