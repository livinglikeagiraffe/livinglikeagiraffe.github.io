import { failLoading } from './loading.js';
// Catch module/renderer startup failures as well as asset failures.
import('./main.js').catch(failLoading);
