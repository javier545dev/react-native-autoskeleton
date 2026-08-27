package com.autoskeleton

import java.util.UUID

// Task 4.4 (tasks.md Phase 4) / plan.md §3.6, ADR-8: Kotlin mirror of the TS
// `ShimmerClock` contract (`src/core/contracts.ts`), same structure as iOS's
// `AutoskeletonShimmerClock.swift`. ADR-8's whole point is "phase derived from an
// absolute origin, never from per-frame ticks" — every renderer instance reads the
// SAME `startedAt` epoch-ms origin and computes its own shader translation from
// `phaseAt`/`phaseOffsetMs`, so every shape and every list cell stays in phase with
// zero cross-instance coordination.

/** Normalized shimmer phase in [0, 1). Mirrors `ClockPhase` in `src/core/contracts.ts`. */
typealias AutoskeletonClockPhase = Double

class AutoskeletonShimmerClock(
    val id: String = UUID.randomUUID().toString(),
    periodMs: Double = 1500.0,
    private val now: () -> Double = { System.currentTimeMillis().toDouble() },
) {
    /** Android tier-1 always ticks via `Choreographer`/`postInvalidateOnAnimation`
     *  (brief §4 "Renderers > Default"), never per-frame JS. */
    val driver = "choreographer"
    val startedAt: Double = now()

    var periodMs: Double = periodMs
        private set
    var isPaused = false
        private set

    /** Pure function of time — used by the renderer on every draw and directly by
     *  tests. */
    fun phaseAt(timestampMs: Double): AutoskeletonClockPhase {
        val elapsed = timestampMs - startedAt
        val wrapped = normalizeRemainder(elapsed, periodMs)
        return wrapped / periodMs
    }

    /** Negative offset a joining renderer could use to start already in phase.
     *  Kept for parity with the TS/iOS contracts even though this renderer's own
     *  draw loop uses [phaseAt] directly rather than a native animation API with a
     *  `beginTime`/`animation-delay` concept. */
    fun phaseOffsetMs(nowMs: Double): Double {
        val elapsed = normalizeRemainder(nowMs - startedAt, periodMs)
        return -elapsed
    }

    fun setPeriod(ms: Double) {
        periodMs = ms
    }

    fun pause() {
        isPaused = true
    }

    fun resume() {
        isPaused = false
    }

    private fun normalizeRemainder(value: Double, modulus: Double): Double {
        val wrapped = value.rem(modulus)
        return if (wrapped < 0) wrapped + modulus else wrapped
    }
}
