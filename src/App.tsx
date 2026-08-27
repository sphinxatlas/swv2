import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SourceLibrary from "./pages/SourceLibrary";
import TopicBriefs from "./pages/TopicBriefs";
import PipelineView from "./pages/PipelineView";
import TranscriptLibrary from "./pages/TranscriptLibrary";
import NotFound from "./pages/NotFound";
import { ChannelProvider } from "@/contexts/ChannelContext";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ChannelProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SourceLibrary />} />
            <Route path="/briefs" element={<TopicBriefs />} />
            <Route path="/briefs/:briefId" element={<PipelineView />} />
            <Route path="/transcripts" element={<TranscriptLibrary />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ChannelProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
