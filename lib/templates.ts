// ============================================================
// lib/templates.ts
// Template Hub — 10 production-ready automation templates
// ============================================================

export interface TemplateField {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  type: "text" | "url" | "email" | "select";
  options?: string[];
}

export interface Template {
  id: string;
  title: string;
  description: string;
  category: "Research" | "Actions" | "Monitoring" | "Utility";
  icon: string;
  estimatedTime: string;
  isCustom?: boolean;
  fields: TemplateField[];
  buildGoal: (inputs: Record<string, string>) => { url: string; goal: string };
  expectedOutputSchema: Record<string, string>;
}

export const TEMPLATES: Template[] = [
  {
    id: "company-intelligence",
    title: "Company Intelligence Scanner",
    description: "Extract company overview, founding year, team size, products, and contact info from any company website.",
    category: "Research",
    icon: "🏢",
    estimatedTime: "~60s",
    fields: [
      { key: "url", label: "Company Website URL", placeholder: "https://example.com", required: true, type: "url" },
    ],
    buildGoal: ({ url }) => ({
      url,
      goal: `Visit this company website and extract: company name, founding year, headquarters location, number of employees (if shown), main products or services (list up to 5), mission statement or tagline, and contact email or phone. Return as JSON with keys: name, founded, location, employees, products, tagline, contact.`,
    }),
    expectedOutputSchema: {
      name: "string",
      founded: "string",
      location: "string",
      employees: "string",
      products: "string[]",
      tagline: "string",
      contact: "string",
    },
  },
  {
    id: "career-page-jobs",
    title: "Career Page Job Extractor",
    description: "Scrape open job listings from any company careers page — titles, departments, locations, and links.",
    category: "Research",
    icon: "💼",
    estimatedTime: "~50s",
    fields: [
      { key: "url", label: "Careers Page URL", placeholder: "https://example.com/careers", required: true, type: "url" },
      { key: "role", label: "Filter by Role (optional)", placeholder: "Engineer, Designer…", required: false, type: "text" },
    ],
    buildGoal: ({ url, role }) => ({
      url,
      goal: `Visit this careers page and extract all open job listings${role ? ` related to "${role}"` : ""}. For each job extract: title, department, location, employment type (full-time/part-time/contract), and the direct application URL if available. Return as JSON array with keys: title, department, location, type, url. Extract up to 20 jobs.`,
    }),
    expectedOutputSchema: {
      jobs: "Array<{ title, department, location, type, url }>",
    },
  },
  {
    id: "price-comparison",
    title: "Product Price Comparison",
    description: "Find and compare prices for a product across Amazon, Flipkart, and Croma.",
    category: "Research",
    icon: "💰",
    estimatedTime: "~90s",
    fields: [
      { key: "product", label: "Product Name", placeholder: "iPhone 15 Pro 256GB", required: true, type: "text" },
      {
        key: "sites",
        label: "Compare On",
        placeholder: "Select sites",
        required: true,
        type: "select",
        options: ["Amazon & Flipkart", "Amazon only", "Flipkart only", "Amazon, Flipkart & Croma"],
      },
    ],
    buildGoal: ({ product, sites }) => {
      const siteInstructions: Record<string, string> = {
        "Amazon only": `Search for "${product}" on Amazon India (https://www.amazon.in/s?k=${encodeURIComponent(product)}) and extract the top 5 results with: title, price, rating, and URL. Return as JSON with key: amazon (array of {title, price, rating, url}).`,
        "Flipkart only": `Search for "${product}" on Flipkart (https://www.flipkart.com/search?q=${encodeURIComponent(product)}) and extract the top 5 results with: title, price, rating, and URL. Return as JSON with key: flipkart (array of {title, price, rating, url}).`,
        "Amazon & Flipkart": `Search for "${product}" on Amazon India (https://www.amazon.in/s?k=${encodeURIComponent(product)}) and extract top 3 results. Then visit Flipkart (https://www.flipkart.com/search?q=${encodeURIComponent(product)}) and extract top 3 results. Return as JSON with keys: amazon and flipkart, each an array of {title, price, rating, url}.`,
        "Amazon, Flipkart & Croma": `Search for "${product}" on Amazon India, Flipkart, and Croma (https://www.croma.com/searchB?q=${encodeURIComponent(product)}). Extract top 3 results from each. Return as JSON with keys: amazon, flipkart, croma — each an array of {title, price, rating, url}.`,
      };
      return {
        url: `https://www.amazon.in/s?k=${encodeURIComponent(product)}`,
        goal: siteInstructions[sites] ?? siteInstructions["Amazon & Flipkart"],
      };
    },
    expectedOutputSchema: {
      amazon: "Array<{ title, price, rating, url }>",
      flipkart: "Array<{ title, price, rating, url }>",
      croma: "Array<{ title, price, rating, url }> (if selected)",
    },
  },
  {
    id: "contact-form-fill",
    title: "Contact Form Auto-Fill",
    description: "Automatically fill and submit a contact form on any website with your details.",
    category: "Actions",
    icon: "📬",
    estimatedTime: "~45s",
    fields: [
      { key: "url", label: "Contact Page URL", placeholder: "https://example.com/contact", required: true, type: "url" },
      { key: "name", label: "Your Name", placeholder: "John Doe", required: true, type: "text" },
      { key: "email", label: "Your Email", placeholder: "john@example.com", required: true, type: "email" },
      { key: "message", label: "Message", placeholder: "I'd like to learn more about…", required: true, type: "text" },
    ],
    buildGoal: ({ url, name, email, message }) => ({
      url,
      goal: `Visit this contact page and fill in the contact form with: Name = "${name}", Email = "${email}", Message = "${message}". If there is a subject field, use "Inquiry". Submit the form. Return JSON with: submitted (true/false), confirmation_message (any success text shown), and form_fields_found (list of field names detected).`,
    }),
    expectedOutputSchema: {
      submitted: "boolean",
      confirmation_message: "string",
      form_fields_found: "string[]",
    },
  },
  {
    id: "rfq-demo-request",
    title: "RFQ / Demo Request Sender",
    description: "Send a request for quote or demo request to a SaaS or B2B company's website.",
    category: "Actions",
    icon: "📋",
    estimatedTime: "~60s",
    fields: [
      { key: "url", label: "Company Website URL", placeholder: "https://example.com", required: true, type: "url" },
      { key: "name", label: "Your Name", placeholder: "Jane Smith", required: true, type: "text" },
      { key: "email", label: "Work Email", placeholder: "jane@company.com", required: true, type: "email" },
      { key: "company", label: "Your Company", placeholder: "Acme Corp", required: true, type: "text" },
      { key: "message", label: "Request Details", placeholder: "We need pricing for 50 seats…", required: true, type: "text" },
    ],
    buildGoal: ({ url, name, email, company, message }) => ({
      url,
      goal: `Visit this website and find the "Request Demo", "Get a Quote", "Contact Sales", or "Book a Demo" page. Fill in the form with: Name = "${name}", Email = "${email}", Company = "${company}", Message = "${message}". If there is a phone field, skip it. Submit the form. Return JSON with: submitted (true/false), page_found (URL of the form page), confirmation_text (success message if any).`,
    }),
    expectedOutputSchema: {
      submitted: "boolean",
      page_found: "string",
      confirmation_text: "string",
    },
  },
  {
    id: "competitor-snapshot",
    title: "Competitor Page Snapshot",
    description: "Extract pricing plans, key features, and positioning from a competitor's website.",
    category: "Research",
    icon: "🔍",
    estimatedTime: "~75s",
    fields: [
      { key: "url", label: "Competitor Website URL", placeholder: "https://competitor.com", required: true, type: "url" },
    ],
    buildGoal: ({ url }) => ({
      url,
      goal: `Visit this website and extract competitive intelligence: 1) Pricing plans — find the pricing page and extract all plan names, prices, and key features for each plan. 2) Main value proposition — the headline or tagline on the homepage. 3) Key features — list up to 8 main product features. 4) Target customers — who they say they serve. 5) Integrations — any tools they integrate with. Return as JSON with keys: pricing_plans (array of {name, price, features}), tagline, key_features, target_customers, integrations.`,
    }),
    expectedOutputSchema: {
      pricing_plans: "Array<{ name, price, features }>",
      tagline: "string",
      key_features: "string[]",
      target_customers: "string",
      integrations: "string[]",
    },
  },
  {
    id: "news-extractor",
    title: "News & Article Extractor",
    description: "Extract the latest news articles or blog posts from any news site or company blog.",
    category: "Monitoring",
    icon: "📰",
    estimatedTime: "~45s",
    fields: [
      { key: "url", label: "News/Blog URL", placeholder: "https://techcrunch.com or https://example.com/blog", required: true, type: "url" },
      { key: "topic", label: "Filter by Topic (optional)", placeholder: "AI, funding, product launch…", required: false, type: "text" },
      { key: "count", label: "Number of Articles", placeholder: "10", required: false, type: "text" },
    ],
    buildGoal: ({ url, topic, count }) => ({
      url,
      goal: `Visit this news or blog page and extract the ${count || "10"} most recent articles${topic ? ` related to "${topic}"` : ""}. For each article extract: title, author (if shown), published date, summary or first 2 sentences, and the article URL. Return as JSON array with keys: title, author, date, summary, url.`,
    }),
    expectedOutputSchema: {
      articles: "Array<{ title, author, date, summary, url }>",
    },
  },
  {
    id: "shipment-tracking",
    title: "Shipment Tracker",
    description: "Track a shipment on Delhivery, Bluedart, or DTDC using a tracking number.",
    category: "Monitoring",
    icon: "📦",
    estimatedTime: "~40s",
    fields: [
      { key: "carrier", label: "Carrier", placeholder: "Select carrier", required: true, type: "select", options: ["Delhivery", "Bluedart", "DTDC", "Ekart"] },
      { key: "tracking_number", label: "Tracking Number", placeholder: "1234567890", required: true, type: "text" },
    ],
    buildGoal: ({ carrier, tracking_number }) => {
      const urls: Record<string, string> = {
        Delhivery: `https://www.delhivery.com/track/package/${tracking_number}`,
        Bluedart: `https://www.bluedart.com/tracking`,
        DTDC: `https://www.dtdc.in/tracking.asp`,
        Ekart: `https://ekartlogistics.com/shipmenttrack/${tracking_number}`,
      };
      return {
        url: urls[carrier] || `https://www.delhivery.com/track/package/${tracking_number}`,
        goal: `Track shipment with tracking number "${tracking_number}" on ${carrier}. Extract: current status, last location, last update timestamp, estimated delivery date (if shown), and full tracking history (list of events with date, location, status). Return as JSON with keys: status, last_location, last_updated, estimated_delivery, history (array of {date, location, event}).`,
      };
    },
    expectedOutputSchema: {
      status: "string",
      last_location: "string",
      last_updated: "string",
      estimated_delivery: "string",
      history: "Array<{ date, location, event }>",
    },
  },
  {
    id: "hackathon-event-extractor",
    title: "Hackathon & Event Finder",
    description: "Find upcoming hackathons, tech events, or competitions from Devfolio, Unstop, or both at once.",
    category: "Research",
    icon: "🏆",
    estimatedTime: "~50s",
    fields: [
      {
        key: "sources",
        label: "Sources",
        placeholder: "Select sources",
        required: true,
        type: "select",
        options: ["Devfolio only", "Unstop only", "Both Devfolio & Unstop", "Custom URL"],
      },
      { key: "custom_url", label: "Custom URL (if selected above)", placeholder: "https://events.example.com", required: false, type: "url" },
      { key: "filter", label: "Filter (optional)", placeholder: "AI, Web3, open to all…", required: false, type: "text" },
    ],
    buildGoal: ({ sources, custom_url, filter }) => {
      const urlMap: Record<string, string> = {
        "Devfolio only": "https://devfolio.co/hackathons",
        "Unstop only": "https://unstop.com/hackathons",
        "Both Devfolio & Unstop": "https://devfolio.co/hackathons",
        "Custom URL": custom_url || "https://devfolio.co/hackathons",
      };

      const extraInstruction = sources === "Both Devfolio & Unstop"
        ? `After extracting from Devfolio, also visit https://unstop.com/hackathons and extract events from there too. Combine all results.`
        : "";

      return {
        url: urlMap[sources] || "https://devfolio.co/hackathons",
        goal: `Visit this page and extract upcoming hackathons or tech events${filter ? ` related to "${filter}"` : ""}. For each event extract: name, organizer, start date, end date, location (online/offline/city), prize pool (if shown), registration deadline, and registration URL. ${extraInstruction} Return as JSON array with keys: name, organizer, start_date, end_date, location, prize, deadline, url. Extract up to 20 events.`,
      };
    },
    expectedOutputSchema: {
      events: "Array<{ name, organizer, start_date, end_date, location, prize, deadline, url }>",
    },
  },
  {
    id: "website-data-scraper",
    title: "Website Data Scraper",
    description: "Extract any structured data from a webpage — tables, lists, product cards, or directory listings.",
    category: "Utility",
    icon: "🗂️",
    estimatedTime: "~60s",
    fields: [
      { key: "url", label: "Page URL", placeholder: "https://example.com/directory", required: true, type: "url" },
      { key: "data_description", label: "What to Extract", placeholder: "All restaurant names, addresses, and phone numbers", required: true, type: "text" },
      { key: "format", label: "Output Format", placeholder: "Select format", required: false, type: "select", options: ["JSON array", "Key-value pairs", "Table rows"] },
    ],
    buildGoal: ({ url, data_description, format }) => ({
      url,
      goal: `Visit this page and extract: ${data_description}. Return the data as ${format || "a JSON array"}. Be thorough — scroll down if needed to load more content. Extract up to 50 items. If the data is paginated, extract from the first page only.`,
    }),
    expectedOutputSchema: {
      data: "Array<Record<string, string>>",
      total_extracted: "number",
    },
  },
];

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export const TEMPLATE_CATEGORIES = ["All", "Research", "Actions", "Monitoring", "Utility"] as const;
