import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Button, Card, LoadingState, ErrorState, EmptyState } from "@/components/shared";
import { api } from "@/lib/api-client";

interface Report {
  appointmentId: number; status: string; revision: number;
  identity: { patientName: string; patientIdentifier: string; accession: string; examination: string; studyDate: string };
  sections: Record<string,string>; author: string; finalizer: string | null; finalizedAt: string | null;
  keyImages: { id: string; caption: string; provenance: { sourceStudyDate: string; sourceSeriesDescription: string; prior: boolean } }[];
  addenda: { id: string; text: string; author: string; signedAt: string }[];
}
const labels: Record<string,string> = {clinicalHistory:"Clinical history",comparison:"Comparison",technique:"Technique",findings:"Findings",impression:"Impression"};
export function NativeReportPage() {
  const { appointmentId = "" } = useParams();
  const valid=Number.isSafeInteger(Number(appointmentId)) && Number(appointmentId)>0;
  const query=useQuery({queryKey:["native-report",appointmentId],enabled:valid,queryFn:()=>api<{report:Report|null}>(`/native-reporting/appointments/${appointmentId}`),retry:false});
  const report=query.data?.report;
  const base=`/api/native-reporting/appointments/${appointmentId}`;
  return <main className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
    <h1 className="text-2xl font-semibold">RISpro report</h1>
    {query.isLoading && <LoadingState message="Loading report…"/>}
    {(!valid || query.error) && <ErrorState message={query.error?.message || "Invalid appointment."}/>}
    {query.isSuccess && !report && <EmptyState message="No native report. Open this case in OHIF and explicitly select Create RISpro Report if it is eligible."/>}
    {report && <>
      <Card><h2 className="text-xl font-semibold" dir="auto">{report.identity.patientName}</h2><p>{report.identity.patientIdentifier} · {report.identity.accession}</p>
        <p>{report.identity.examination} · {report.identity.studyDate}</p><p className="font-semibold">{report.status==="final"?"Final — signed":"Draft — unsigned"}</p>
        <p>Author: {report.author}{report.finalizer && <> · Signed by {report.finalizer} · {report.finalizedAt && new Date(report.finalizedAt).toLocaleString()}</>}</p>
        <Button variant="secondary" onClick={()=>window.open(base+"/print","_blank","noopener")}>Print / Save as PDF</Button>
      </Card>
      <Card>{Object.entries(labels).filter(([key])=>report.sections[key]).map(([key,label])=><section className="mb-4" key={key}><h2 className="text-lg font-semibold">{label}</h2><p className="whitespace-pre-wrap" dir="auto">{report.sections[key]}</p></section>)}</Card>
      {report.keyImages.map((image,index)=><Card key={image.id}><figure><a href={base+"/images/"+image.id} target="_blank" rel="noopener noreferrer"><img className="mx-auto max-h-[70vh] max-w-full object-contain" src={base+"/images/"+image.id} alt={`Key image ${index+1}`}/></a><figcaption>{index+1}. {image.caption}<br/>{image.provenance.sourceSeriesDescription} · {image.provenance.sourceStudyDate} {image.provenance.prior?"(prior study)":""}</figcaption></figure></Card>)}
      {report.addenda.map(a=><Card key={a.id}><h2 className="text-lg font-semibold">Signed addendum</h2><p className="whitespace-pre-wrap" dir="auto">{a.text}</p><p>{a.author} · {new Date(a.signedAt).toLocaleString()}</p></Card>)}
    </>}
  </main>;
}
