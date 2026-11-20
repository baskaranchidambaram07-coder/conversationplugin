// When the visitor has finished speaking, judged from the microphone's loudness frame by frame (M11).

/** Loud means over 2.5 times the quietest frame so far, and never under 1.5% of full scale. */
export class Endpointer {
  private floor = 0.01;
  private spoke = false;
  private loudFor = 0;
  private quietFor = 0;
  private elapsed = 0;

  constructor(
    private readonly endAfter = 800, // ms of quiet after speech that end it
    private readonly giveUpAfter = 8000, // ms with no speech at all
    private readonly longest = 60_000, // ms of audio the gateway takes in one utterance
  ) {}

  /** `level`: the root mean square, 0 to 1, of the last `ms` of audio. True once listening should stop. */
  push(level: number, ms: number): boolean {
    this.elapsed += ms;
    this.floor = Math.min(this.floor, Math.max(level, 0.001));
    if (level > Math.max(0.015, this.floor * 2.5)) {
      this.loudFor += ms;
      this.quietFor = 0;
      if (this.loudFor >= 200) this.spoke = true;
    } else {
      this.loudFor = 0;
      this.quietFor += ms;
    }
    if (this.elapsed >= this.longest) return true;
    return this.spoke ? this.quietFor >= this.endAfter : this.elapsed >= this.giveUpAfter;
  }
}
