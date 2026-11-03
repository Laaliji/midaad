import { render } from 'preact';
import '../shared/ui/tokens.css';
import '../shared/ui/controls.css';
import '../shared/ui/article.css';
import './options.css';
import { loadFonts } from '../shared/fonts';
import { App } from './App';

// The options UI follows the system light/dark preference. The reader theme is a separate setting.
const media = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => (document.documentElement.dataset.theme = media.matches ? 'dark' : 'light');
applyTheme();
media.addEventListener('change', applyTheme);

void loadFonts(['literata', 'source-sans', 'atkinson', 'opendyslexic', 'noto-naskh', 'amiri'], document.fonts, 'url');

render(<App />, document.getElementById('app')!);
