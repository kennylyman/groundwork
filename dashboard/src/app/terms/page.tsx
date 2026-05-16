import Link from 'next/link'
import { ArrowLeft, Eye, Activity, Globe, Send, Lock, MessageCircle } from 'lucide-react'

export const metadata = {
  title: 'Data Collection Disclosure — Groundwork',
  description:
    'What Groundwork captures, what it does not capture, and how to opt out.',
}

const POINTS = [
  {
    icon: Eye,
    title: 'Screenshots every 30 seconds',
    body:
      'Groundwork captures an image of your screen approximately every 30 seconds. Images are used by an AI model to classify the kind of work you are doing (e.g. "scheduling a shift" or "processing an invoice"). They are not stored beyond the time needed to classify them, and the classification is what your employer sees.',
  },
  {
    icon: Activity,
    title: 'Keystroke and mouse-click counts (not content)',
    body:
      'We count how many times you press a key and how many times you click during each 30-second window. We do NOT record the actual keys, the text you type, the buttons you click, or anything you say. The count is used to tell whether you are actively working, idle, or doing repetitive data entry.',
  },
  {
    icon: Globe,
    title: 'Active window titles and URLs',
    body:
      'We record the title of the window you currently have in focus (e.g. "Inbox — Gmail") and, when you are in a browser, the URL of the active tab. We do not record other open tabs, your browsing history, or the content of any web page.',
  },
  {
    icon: Send,
    title: 'Data is sent to your employer’s dashboard',
    body:
      'The information above is sent securely to a private Groundwork dashboard controlled by your employer. Only people your employer authorizes can see it. Your employer is responsible for how the data is used internally.',
  },
  {
    icon: Lock,
    title: 'What we do NOT record',
    body:
      'No passwords. No personal messages, emails, or chat content. No typed text of any kind. No data from other devices (only the machine Groundwork is installed on, while you are signed in to it). No microphone or camera access.',
  },
  {
    icon: MessageCircle,
    title: 'Stopping data collection',
    body:
      'You can ask your manager or your employer’s account owner to pause or stop Groundwork at any time — they can do this from their dashboard. You can also uninstall the agent from your machine yourself. There is no penalty in the software for either choice.',
  },
]

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>
          <div className="w-px h-4 bg-gray-200" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gray-900 rounded-lg flex items-center justify-center text-white text-sm">
              ⚡
            </div>
            <span className="text-sm font-semibold text-gray-900">Groundwork</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-8 py-12">
        <header className="mb-10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 font-medium mb-3">
            Disclosure
          </p>
          <h1 className="text-3xl font-semibold text-gray-900 leading-tight tracking-tight mb-3">
            What Groundwork captures, in plain English
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed max-w-2xl">
            Groundwork is a workplace tool that helps your employer understand how
            time is spent across the team and where work could be automated. Before
            you install it, read what it does — and what it doesn&rsquo;t do.
          </p>
        </header>

        <div className="space-y-3">
          {POINTS.map((p) => (
            <section
              key={p.title}
              className="bg-white rounded-2xl border border-gray-200 p-6"
            >
              <div className="flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center">
                  <p.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-gray-900 mb-1.5">
                    {p.title}
                  </h2>
                  <p className="text-sm text-gray-600 leading-relaxed">{p.body}</p>
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 bg-gray-900 rounded-2xl p-6 text-white">
          <h2 className="text-sm font-semibold mb-2">Questions or concerns?</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Your employer is the right place to start. They control the Groundwork
            dashboard for your team and can answer questions about how the data is
            used, who has access, and how long it&rsquo;s retained.
          </p>
        </div>

        <p className="text-[11px] text-gray-400 text-center mt-8">
          Groundwork · gwork.tech
        </p>
      </div>
    </div>
  )
}
