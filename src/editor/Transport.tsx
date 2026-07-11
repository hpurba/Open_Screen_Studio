import { Icon } from "./icons";
import { clamp, formatDuration } from "./utils";

type TransportProps = {
  time: number;
  start: number;
  end: number;
  playing: boolean;
  disabled?: boolean;
  onTimeChange: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
};

export function Transport({
  time,
  start,
  end,
  playing,
  disabled,
  onTimeChange,
  onPlayingChange,
}: TransportProps) {
  const jump = (amount: number) => onTimeChange(clamp(time + amount, start, end));
  return (
    <div className="transport" aria-label="Playback controls">
      <div className="transport-time current">{formatDuration(time, true)}</div>
      <div className="transport-center">
        <button className="icon-button transport-skip" onClick={() => jump(-5000)} aria-label="Go back 5 seconds" title="Back 5 seconds">
          <Icon name="skip-back" size={17} />
        </button>
        <button
          className="play-button"
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          disabled={disabled}
        >
          <span className="icon-swap" key={playing ? "pause" : "play"}>
            <Icon name={playing ? "pause" : "play"} size={17} />
          </span>
        </button>
        <button className="icon-button transport-skip" onClick={() => jump(5000)} aria-label="Go forward 5 seconds" title="Forward 5 seconds">
          <Icon name="skip-forward" size={17} />
        </button>
      </div>
      <div className="transport-time total">{formatDuration(end)}</div>
    </div>
  );
}
