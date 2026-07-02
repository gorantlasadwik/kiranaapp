import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Let's run a single product through the main fetch logic to see it download, run OCR, and score.
console.log('Spawning partial run...');

// We will import fetch_images but since it executes run() immediately at the bottom:
// Let's modify run() in a temporary file to run only on a single product index or just run node directly on the file with a flag or environment variable!
// Ah! We can set an env variable e.g. TEST_SINGLE_PRODUCT="Dove" and match in run() to skip others.
// That is brilliant! Let's see if run() can check process.env.TEST_LIMIT.
