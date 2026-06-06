import { describe, expect, test } from 'bun:test'
import { AgentAskUserService } from './agent-ask-user-service.ts'

describe('AgentAskUserService', () => {
  test('Given pending AskUser request When cancelled Then only that request resolves as deny', async () => {
    const service = new AgentAskUserService()
    const controller = new AbortController()
    const requests: Array<{ requestId: string; sessionId: string }> = []

    const first = service.handleAskUserQuestion(
      'session-a',
      { questions: [{ question: '选择方案', options: [] }] },
      controller.signal,
      (request) => { requests.push({ requestId: request.requestId, sessionId: request.sessionId }) },
    )
    const second = service.handleAskUserQuestion(
      'session-a',
      { questions: [{ question: '输入路径', options: [] }] },
      controller.signal,
      (request) => { requests.push({ requestId: request.requestId, sessionId: request.sessionId }) },
    )

    const firstRequest = requests[0]
    const secondRequest = requests[1]
    expect(firstRequest).toBeDefined()
    expect(secondRequest).toBeDefined()

    const cancelledSessionId = service.cancelAskUser(firstRequest?.requestId ?? '', '用户取消了 AskUserQuestion')

    expect(cancelledSessionId).toBe('session-a')
    await expect(first).resolves.toEqual({ behavior: 'deny', message: '用户取消了 AskUserQuestion' })
    expect(service.getPendingRequests().map((request) => request.requestId)).toEqual([secondRequest?.requestId ?? ''])

    const resolvedSessionId = service.respondToAskUser(secondRequest?.requestId ?? '', { 输入路径: '/tmp/out' })

    expect(resolvedSessionId).toBe('session-a')
    await expect(second).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        questions: [{ question: '输入路径', options: [] }],
        answers: { 输入路径: '/tmp/out' },
      },
    })
  })
})
