const TIME_TO_EXIT_PROCESS_IN_MS = 10_000
const TIME_TO_KILL_DISCONNECTED_WORKER_IN_MS = 5_000

/**
 * @typedef {import('cluster').Worker} ClusterWorker
 */

/**
 * Recursively disconnects and exits all workers in a cluster with a specified timeout.
 *
 * @param {(ClusterWorker|null|undefined)[]} allWorkers - An array of all cluster worker objects.
 * @param {number} currentWorkerIndex - The current index of the worker being processed.
 * @param {number} restartTime - The timeout (in milliseconds) before disconnecting the next worker. Defaults to `TIME_TO_EXIT_PROCESS_IN_MS` if not provided.
 * @param {function(Error|null, ClusterWorker[]|null): void} callback
 *
 * @description
 * This function recursively disconnects and exits each worker in the `allWorkers` array.
 * Each worker is disconnected (so it stops accepting new connections) and killed if it's still alive after a timeout.
 * A timeout is applied between processing each worker, allowing them to exit gracefully before the next worker is processed.
 * Workers that are already disconnected are skipped.
 *
 * If all workers are processed without errors, the `callback` is invoked with the `allWorkers` array.
 * If an error occurs during processing, the `callback` is invoked with the error and `null`.
 */
export default function disconnectAndExitAllWorkersWithTimeoutRecursively(
  allWorkers,
  currentWorkerIndex,
  restartTime,
  callback
) {
  if (currentWorkerIndex >= allWorkers.length) {
    callback(null, /** @type {ClusterWorker[]} */ (allWorkers.filter(Boolean)))
    return
  }
  const currentWorker = allWorkers[currentWorkerIndex]
  const next = () => disconnectAndExitAllWorkersWithTimeoutRecursively(
    allWorkers,
    currentWorkerIndex + 1,
    restartTime,
    callback
  )
  if (!currentWorker || !currentWorker.process.connected) {
    next()
    return
  }
  try {
    setTimeout(() => {
      try {
        next()
      } catch (error) {
        callback(toError(error), null)
      }
    }, restartTime || TIME_TO_EXIT_PROCESS_IN_MS)
    currentWorker.disconnect()
    setTimeout(() => {
      if (!currentWorker.isDead()) {
        currentWorker.kill()
      }
    }, TIME_TO_KILL_DISCONNECTED_WORKER_IN_MS)
  } catch (error) {
    callback(toError(error), null)
  }
}

/**
 * @param {unknown} error
 * @returns {Error}
 */
function toError(error) {
  return error instanceof Error ? error : new Error(String(error))
}
