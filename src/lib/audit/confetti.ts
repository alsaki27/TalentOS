import confetti from "canvas-confetti";

/** Fired when a candidate transitions to placed, porting skarion-student-audit's placement celebration. */
export function fireCelebration() {
  confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: ["#8b5cf6", "#fb923c", "#34d399", "#38bdf8"] });
  setTimeout(() => confetti({ particleCount: 60, spread: 100, origin: { y: 0.5 } }), 200);
}
