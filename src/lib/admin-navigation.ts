import { BarChart3, BookOpen, BriefcaseBusiness, CalendarDays, FileText, FolderOpen, Home, Image, LayoutDashboard, ListTree, MessageSquare, Package, Search, Settings, ShieldCheck, SlidersHorizontal, Target, Users, Video } from "lucide-react";

export const adminGroups = [
  { id: "overview", name: "Start Here", description: "Find your way around and see what needs attention.", items: [
    { name: "Business Operations", href: "/admin/business", icon: BriefcaseBusiness, description: "Run clients, engagements, delivery, invoices, expenses, time, and follow-ups in your private owner workspace." },
    { name: "Overview", href: "/admin", icon: LayoutDashboard, description: "See new inquiries, content totals, and shortcuts to common tasks." },
    { name: "Business Model & Positioning", href: "/admin/business-model", icon: BriefcaseBusiness, description: "Set up your four service pillars, two customer paths, project offers, and monthly care plans." },
    { name: "Where to Edit", href: "/admin/content", icon: ListTree, description: "Find the right editor for each website page and see what can be changed." },
  ] },
  { id: "content", name: "Website Content", description: "Change what visitors read and see on your website.", items: [
    { name: "Edit Homepage", href: "/admin/page-builder", icon: Home, description: "Edit homepage text, sections, FAQs, buttons, and homepage SEO." },
    { name: "Business Owner Path", href: "/admin/pages/for-businesses", icon: BriefcaseBusiness, description: "Edit the service journey for business owners: websites, care, customer support systems, and automation." },
    { name: "Founder Path", href: "/admin/pages/for-founders", icon: Target, description: "Edit the service journey for founders and product teams: discovery, engineering, and ongoing product management." },
    { name: "Edit About", href: "/admin/pages/about", icon: FileText, description: "Edit your biography, experience, education, certifications, profile image, and About page SEO." },
    { name: "Website Pages", href: "/admin/pages", icon: ListTree, description: "Edit About, How I Work, Contact, Booking, legal pages, and page introductions." },
    { name: "Project Case Studies", href: "/admin/case-studies", icon: FolderOpen, description: "Edit project stories, technical details, outcomes, and screenshots." },
    { name: "Blog Articles", href: "/admin/blog", icon: BookOpen, description: "Write articles, choose categories, and publish or archive posts." },
    { name: "Videos", href: "/admin/videos", icon: Video, description: "Manage the videos shown on the public Videos page." },
    { name: "Client Testimonials", href: "/admin/testimonials", icon: MessageSquare, description: "Add approved client quotes and choose which ones appear publicly." },
    { name: "Images & Files", href: "/admin/media", icon: Image, description: "Upload and manage images, documents, and other media files." },
  ] },
  { id: "offers", name: "Services & Pricing", description: "Describe how clients can hire you and what each offer includes.", items: [
    { name: "Service Pages", href: "/admin/services", icon: BriefcaseBusiness, description: "Explain your capabilities, intended clients, and service deliverables." },
    { name: "Engagements & Pricing", href: "/admin/packages", icon: Package, description: "Edit offer scope, add-ons, pricing models, and optional public prices." },
  ] },
  { id: "clients", name: "Client Inquiries", description: "Follow up with potential clients and review scheduling setup.", items: [
    { name: "Project Inquiries", href: "/admin/leads", icon: Users, description: "Read contact submissions, update lead status, and keep follow-up notes." },
    { name: "Booking Setup", href: "/admin/bookings", icon: CalendarDays, description: "Check the calendar provider connection; appointments are managed by the provider." },
  ] },
  { id: "settings", name: "Website Settings", description: "Manage site-wide links, contact information, and search visibility.", items: [
    { name: "Menu Links", href: "/admin/navigation", icon: ListTree, description: "Change the links and labels in the public website navigation." },
    { name: "Search & Social Sharing", href: "/admin/seo", icon: Search, description: "Manage default search titles, descriptions, and the social sharing image." },
    { name: "Contact & Site Settings", href: "/admin/settings", icon: Settings, description: "Edit public contact details, budget choices, footer links, and trust logos." },
    { name: "Traffic & Conversions", href: "/admin/analytics", icon: BarChart3, description: "Review inquiry totals and check analytics and conversion tracking setup." },
  ] },
  { id: "access", name: "Access & Activity", description: "Manage administrator access and review recorded changes.", items: [
    { name: "Admin Users & Roles", href: "/admin/users", icon: Users, description: "Review administrator accounts and manage owner, editor, and viewer roles." },
    { name: "Security Settings", href: "/admin/security", icon: ShieldCheck, description: "Set the admin inactivity timeout and review login protection." },
    { name: "Change History", href: "/admin/audit-logs", icon: SlidersHorizontal, description: "See recorded content changes, lead activity, and administrator actions." },
  ] },
];

export function getAdminLocation(pathname: string) {
  for (const group of adminGroups) {
    const item = group.items.find((item) => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)));
    if (item) return { group, item };
  }
  return undefined;
}
