import neutral from '../../art/assistant/v1/neutral.png';
import speaking from '../../art/assistant/v1/speaking.png';
import blink from '../../art/assistant/v1/blink.png';
import pointLeft from '../../art/assistant/v1/point-left.png';
import pointRight from '../../art/assistant/v1/point-right.png';

export function GuideAvatar({ pose = 'neutral', talking = false }: { pose?: 'neutral' | 'left' | 'right'; talking?: boolean }) {
  return <span className="guide-avatar" aria-hidden="true">
    <img src={pose === 'left' ? pointLeft : pose === 'right' ? pointRight : neutral} alt="" draggable={false}/>
    {pose === 'neutral' && <>
      {talking && <img className="guide-mouth" src={speaking} alt="" draggable={false}/>}
      <img className="guide-blink" src={blink} alt="" draggable={false}/>
    </>}
  </span>;
}
