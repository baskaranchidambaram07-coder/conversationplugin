// The microphone in the audio thread (M11): its samples, at the device's own rate, brought down to 16 kHz 16-bit
// mono PCM and posted in 100 ms frames, each with its loudness. Loaded as a file of our own (script-src 'self').
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples to each output sample
    this.at = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(1600);
    this.filled = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count++;
      if (++this.at < this.step) continue;
      this.at -= this.step;
      const value = Math.max(-1, Math.min(1, this.sum / this.count)); // the mean: a plain low-pass before dropping
      this.sum = 0;
      this.count = 0;
      this.energy += value * value;
      this.frame[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.filled === this.frame.length) {
        const level = Math.sqrt(this.energy / this.filled);
        this.port.postMessage({ pcm: this.frame.buffer, level }, [this.frame.buffer]);
        this.frame = new Int16Array(1600);
        this.filled = 0;
        this.energy = 0;
      }
    }
    return true;
  }
}

registerProcessor("ucp-capture", Capture);
