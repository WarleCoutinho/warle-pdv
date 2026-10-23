import { useEffect, useRef, useState } from 'react';
import type { AppPage } from '../types/navigation';
import { answerOperatorQuestion, guidePages } from '../utils/operatorGuide';
import './OperatorAssistant.css';
import { GuideAvatar } from './GuideAvatar';
import { ScreenGuide } from './ScreenGuide';

export function OperatorAssistant({ page }: { page: AppPage }) {
  const [open, setOpen] = useState(false);
  const [tour, setTour] = useState(false);
  const [talking, setTalking] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ question: string; answer: string; page: string }[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const context = guidePages[page];
  useEffect(() => { setTour(false); }, [page]);
  useEffect(() => { if (!talking) return; const timer = window.setTimeout(() => setTalking(false), 2400); return () => window.clearTimeout(timer); }, [talking]);
  function closeTour() { setTour(false); launcher.current?.focus(); }
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, open]);
  function close() { setOpen(false); launcher.current?.focus(); }
  function ask(value: string) {
    const trimmed = value.trim().slice(0, 1000);
    if (!trimmed) return;
    setMessages(previous => [...previous.slice(-19), { question: trimmed, answer: answerOperatorQuestion(trimmed, page), page: context.label }]);
    setQuestion(''); setTalking(true); input.current?.focus();
  }
  return <aside className="operator-assistant" aria-label="Assistente do operador">
    {tour && <ScreenGuide key={page} page={page} onClose={closeTour} onAsk={() => { setTour(false); setOpen(true); }}/>}
    {open && <section id="operator-assistant-panel" className="assistant-panel" aria-labelledby="assistant-title" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <header className="assistant-header"><GuideAvatar talking={talking}/><div><h2 id="assistant-title">Assistente Raiz</h2><small>Guia local · somente orientações</small></div><button type="button" aria-label="Fechar assistente" onClick={close}>×</button></header>
      <button type="button" className="assistant-start-guide" onClick={() => { setOpen(false); setTour(true); }}>{page === 'pos' ? 'Conhecer a tela de venda →' : 'Conhecer esta tela →'}</button>
      <div className="assistant-context"><b>Você está em {context.label}</b><p>{context.explanation}</p></div>
      <div ref={log} className="assistant-messages" role="log" aria-label="Perguntas e orientações" aria-live="polite" aria-relevant="additions">
        {!messages.length && <p>Olá! Posso ajudar a entender as telas e os indicadores do PDV. Escolha uma sugestão ou escreva sua dúvida.</p>}
        {messages.map((message, index) => <div key={index} className="assistant-exchange"><p className="assistant-question"><b>Você · {message.page}</b>{message.question}</p><p className="assistant-answer"><b>Assistente</b>{message.answer}</p></div>)}
      </div>
      <div className="assistant-suggestions" aria-label="Sugestões de perguntas">{context.questions.map(value => <button key={value} type="button" onClick={() => ask(value)}>{value}</button>)}</div>
      <form className="assistant-form" onSubmit={event => { event.preventDefault(); ask(question); }}>
        <label htmlFor="assistant-question">Qual é sua dúvida?</label>
        <textarea ref={input} id="assistant-question" value={question} maxLength={1000} rows={2} placeholder="Ex.: faturamento é lucro líquido?" onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(question); } }}/>
        <div><small>Respostas locais, sem IA conectada.</small><button type="submit" disabled={!question.trim()}>Perguntar</button></div>
      </form>
    </section>}
    <button ref={launcher} type="button" className="assistant-launcher" aria-expanded={open} aria-controls="operator-assistant-panel" onClick={() => { setTour(false); open ? close() : setOpen(true); }}><GuideAvatar talking={talking}/><span>Assistente</span></button>
  </aside>;
}
