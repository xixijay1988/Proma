import { describe, expect, test } from 'bun:test'
import { convertPiNativeSessionEntriesToSDKMessages } from './pi-native-session-converter.ts'

describe('Pi native session converter', () => {
  test('Given leaf entry id When converting branched entries Then only returns messages on that branch path', () => {
    const messages = convertPiNativeSessionEntriesToSDKMessages({
      sessionId: 'proma-session',
      leafEntryId: 'target-assistant',
      entries: [
        {
          type: 'message',
          id: 'root-user',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'user', content: 'root prompt' },
        },
        {
          type: 'message',
          id: 'sibling-assistant',
          parentId: 'root-user',
          timestamp: '2026-06-02T00:00:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'sibling answer' }] },
        },
        {
          type: 'message',
          id: 'target-assistant',
          parentId: 'root-user',
          timestamp: '2026-06-02T00:00:03.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'target answer' }] },
        },
      ],
    })

    expect(messages.map((message) => (message as { _promaPiEntryId?: string })._promaPiEntryId)).toEqual([
      'root-user',
      'target-assistant',
    ])
    expect(JSON.stringify(messages)).not.toContain('sibling answer')
  })

  test('Given Pi native JSONL entries When converting Then returns Proma SDK messages for display', () => {
    const messages = convertPiNativeSessionEntriesToSDKMessages({
      sessionId: 'proma-session',
      entries: [
        {
          type: 'message',
          id: 'user-1',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'user', content: 'hello pi' },
        },
        {
          type: 'message',
          id: 'assistant-1',
          parentId: 'user-1',
          timestamp: '2026-06-02T00:00:02.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'checking' },
              { type: 'text', text: 'hello user' },
              { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'README.md' } },
            ],
            model: 'deepseek-v4-flash',
          },
        },
        {
          type: 'message',
          id: 'tool-1',
          parentId: 'assistant-1',
          timestamp: '2026-06-02T00:00:03.000Z',
          message: {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'read',
            content: [{ type: 'text', text: 'README content' }],
            isError: false,
          },
        },
      ],
    })

    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({
      type: 'user',
      session_id: 'proma-session',
      parent_tool_use_id: null,
      _promaPiEntryId: 'user-1',
      _createdAt: Date.parse('2026-06-02T00:00:01.000Z'),
      message: { content: [{ type: 'text', text: 'hello pi' }] },
    })
    expect(messages[1]).toMatchObject({
      type: 'assistant',
      session_id: 'proma-session',
      parent_tool_use_id: null,
      _promaPiEntryId: 'assistant-1',
      message: {
        model: 'deepseek-v4-flash',
        content: [
          { type: 'thinking', thinking: 'checking' },
          { type: 'text', text: 'hello user' },
          { type: 'tool_use', id: 'call-1', name: 'read', input: { path: 'README.md' } },
        ],
      },
    })
    expect(messages[2]).toMatchObject({
      type: 'user',
      session_id: 'proma-session',
      parent_tool_use_id: null,
      _promaPiEntryId: 'tool-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [{ type: 'text', text: 'README content' }],
            is_error: false,
          },
        ],
      },
    })
  })

  test('Given hidden custom message and bash execution When converting Then keeps only displayable messages', () => {
    const messages = convertPiNativeSessionEntriesToSDKMessages({
      sessionId: 'proma-session',
      entries: [
        {
          type: 'message',
          id: 'hidden-custom',
          parentId: null,
          timestamp: '2026-06-02T00:00:01.000Z',
          message: { role: 'custom', customType: 'hidden', display: false, content: 'hidden text' },
        },
        {
          type: 'message',
          id: 'bash-1',
          parentId: 'hidden-custom',
          timestamp: '2026-06-02T00:00:02.000Z',
          message: { role: 'bashExecution', command: 'pwd', output: '/tmp/project', exitCode: 0 },
        },
      ],
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      type: 'assistant',
      _promaPiEntryId: 'bash-1',
      message: {
        content: [{ type: 'text', text: '$ pwd\n/tmp/project' }],
      },
    })
  })
})
