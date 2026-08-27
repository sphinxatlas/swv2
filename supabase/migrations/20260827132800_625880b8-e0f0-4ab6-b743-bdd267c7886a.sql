-- SLV2 Phase 1, step 2: seed the Harry Potter worked examples.

-- Text is copied verbatim from generate-step/index.ts. No rewriting.

-- Culture and Economics is left empty on purpose.

UPDATE public.channels SET

  worked_examples = $w${

 "outline": {

  "body": "EXAMPLE FORMAT (copy this shape, not this content):\n\nContention: The Malfoy family built Draco for a world that no longer exists by the time Voldemort returns.\nSurface expectation: Draco is a spoiled bully who panics when things get real.\n\n1. Open on Madam Malkin's in Half-Blood Prince. Draco drops a slur without pausing, Narcissa threatens Harry and Ron with lethal consequences in a clothing shop, and the whole family dynamic is visible in one tiny scene. Canon anchor: HBP Chapter 6, the robe fitting. The viewer sees the family machine operating normally before anything goes wrong. Sets up the question of where Draco learned to do this.\n\n2. Chamber of Secrets gives the cleanest receipt for Draco's training. Lucius cuts Draco off mid-complaint and turns Hermione beating him in exams into a family humiliation. Canon anchor: CoS Borgin and Burkes eavesdropping scene, Lucius quote. The viewer understands that school performance is a brand management exercise for Lucius, not an education. Sets up the pattern of shame as Draco's primary motivator.\n\n[continues for all beats]"

 },

 "script_evidence_pack": {

  "body": "EXAMPLE FORMAT (copy this shape, not this content):\n\nBeat 1. The opening establishes that Harry has been steered to the Department of Mysteries. In Order of the Phoenix chapters 32 to 35, Rowling makes the manipulation explicit across multiple scenes: every false vision plants urgency, every push from Kreacher nudges Harry toward the Ministry, and the locked door at the Prophecy Hall is designed to confirm the bait. The film compresses this into a rescue mission, removing the engineering almost entirely. No quote needed here. Book and film disagree on what kind of scene this is: the book is about manufactured certainty, the film is about speed.\n\nBeat 2. Dumbledore's knowledge becomes the real accusation. In Deathly Hallows chapter 35, Kings Cross, Dumbledore admits to Harry directly that he knew enough to intervene and chose silence. He names it as his mistake without being asked. Quote worth considering: \"I cared more for your happiness than your knowing the truth.\" This quote appears only in the book; the film never delivers this admission with the same weight.\n\n[continues for all beats]"

 },

 "full_script": {

  "body": "Example of the correct shape (do not copy the content, copy the shape):\n\nHarry walks into the Department of Mysteries believing Sirius is alive. The book makes it obvious he has been steered there. Every clue, every push, every false memory, all engineered. The film softens this into a rescue mission, and that single softening changes who the trap is really about.\n\nBecause in the book, the point is not that Harry walks into danger. The point is that he was made to. Dumbledore knew enough to prevent it. He stayed silent. By the time Harry figures this out, Sirius is gone and the person who could have stopped it is the one Harry is supposed to trust most.\n\n[continues in this register for the full script]"

 },

 "source_specificity_phrasings": {

  "body": "- Vary phrasing naturally so it does not sound repetitive. Examples of varied phrasing:\n  - \"In Order of the Phoenix, Harry's frustration boils over when...\"\n  - \"The fifth film captures this perfectly — Dumbledore barely looks at him...\"\n  - \"By the time we reach Goblet of Fire, the pattern is unmistakable...\"\n  - \"Rowling shows this most clearly in Half-Blood Prince, where...\"\n  - \"There's a moment in the third movie that changes everything...\""

 }

}$w$::jsonb,

  updated_at = now()

WHERE slug = 'harry-potter';