import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

export default function Demo() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="text-center mb-12">
        <h1 className="text-5xl font-bold mb-2">StreamLine</h1>
        <h2 className="text-3xl font-semibold text-gray-700">Choose your StreamLine experience.</h2>
        <p className="text-lg text-gray-500 mt-2">Built for creators, schools, and enterprises — powered by the same core engine.</p>
      </div>
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl w-full">
        {/* StreamLine (Creator) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              🎬 StreamLine
            </CardTitle>
            <CardDescription>Public streams, multistreaming, and guest invites.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-gray-600 mb-6">
              <li>Public streams</li>
              <li>Multistream + overlays</li>
              <li>Guest invites</li>
            </ul>
            <Link to="/welcome">
              <Button className="w-full">
                View Creator Landing <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* StreamLine EDU */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              🎓 StreamLine EDU
            </CardTitle>
            <CardDescription>School broadcasts, events, and role-based access.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-gray-600 mb-6">
              <li>School broadcasts</li>
              <li>Events + replays</li>
              <li>Role-based access</li>
            </ul>
            <Link to="/streamline/edu">
              <Button className="w-full">
                View EDU Landing <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* StreamLine Corporate */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              🏢 StreamLine Corporate
            </CardTitle>
            <CardDescription>Internal comms, training, and compliance tracking.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside text-gray-600 mb-6">
              <li>Internal comms</li>
              <li>Calls + chat + training</li>
              <li>Compliance tracking</li>
            </ul>
            <Link to="/streamline/corporate/landing">
              <Button className="w-full">
                View Corporate Landing <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
