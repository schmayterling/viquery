import { constants, setPriority } from 'node:os'
import type { ComputeApi, UtilityMessage } from '../shared/protocol.ts'
import { mainPort, serve } from '../shared/rpc.ts'
import { createComputeApi } from './api.ts'

setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL)
if (!process.parentPort)
  throw new Error('compute must run in an electron utility process')

let api: ComputeApi | undefined
process.parentPort.on('message', ({ data, ports }) => {
  const message = data as UtilityMessage
  if (message.type === 'init') {
    if (api) throw new Error('compute already initialized')
    api = createComputeApi(message)
  } else if (message.type === 'port' && message.peer === 'catalog') {
    if (!api || !ports[0])
      throw new Error('compute needs init before catalog port')
    serve(mainPort(ports[0]), api)
  } else {
    throw new Error('unexpected compute utility message')
  }
})
